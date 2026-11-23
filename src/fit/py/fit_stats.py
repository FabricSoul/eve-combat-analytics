"""Build the fit with pyfa's EFT importer and read the calculated eos statistics."""

import json
from collections import Counter

import headless


MODULE_CATEGORIES = ('Module', 'Subsystem', 'Structure Module')


class BadEft(ValueError):
    pass


def initialize(db_path):
    headless.bootstrap(db_path)


def load_item_kinds(names_json):
    from service.port.shared import fetchItem

    results = []
    for name in json.loads(names_json):
        item = fetchItem(name, eagerCat=True)
        if item is None:
            continue
        if item.category.name in MODULE_CATEGORIES:
            kind = 'module'
        elif item.category.name == 'Charge':
            kind = 'charge'
        elif item.isDrone:
            kind = 'drone'
        else:
            kind = 'other'
        results.append((name, kind))
    return json.dumps(results)


def fit_from_eft(parsed, drone_stacks):
    from service.port.eft import importEft
    from service.port.shared import fetchItem

    ship = fetchItem(parsed['ship'], eagerCat=True)
    if ship is None or ship.category.name != 'Ship':
        raise BadEft(f"Unknown ship: {parsed['ship']}")

    lines = [f"[{ship.name}, {parsed['name']}]", ""]
    requested_modules = Counter()
    for entry in parsed['modules']:
        name = entry['name']
        module = fetchItem(name, eagerCat=True)
        if module is None or module.category.name not in MODULE_CATEGORIES:
            raise BadEft(f"Unknown fitting module: {name}")
        charge = None
        if 'charge' in entry:
            charge = fetchItem(entry['charge'], eagerCat=True)
            if charge is None or charge.category.name != 'Charge':
                raise BadEft(f"Unknown charge: {entry['charge']}")
        charge_name = charge.name if charge is not None else None
        suffix = ' /offline' if entry['offline'] else ''
        lines.append(module.name + (f', {charge_name}' if charge_name else '') + suffix)
        requested_modules[module.name, charge_name, entry['offline']] += 1

    lines.append('')
    lines.extend(f"{entry['name']} x{entry['count']}" for entry in drone_stacks)
    fit = importEft(lines)
    if fit is None:
        raise BadEft(f"Unable to import fit for {ship.name}")

    from eos.const import FittingModuleState

    fitted_modules = Counter(
        (mod.item.name, mod.charge.name if mod.charge else None, mod.state == FittingModuleState.OFFLINE)
        for mod in fit.modules if not mod.isEmpty
    )
    if missing := requested_modules - fitted_modules:
        module, charge, _ = next(iter(missing))
        item = f'{module} with {charge}' if charge else module
        raise BadEft(f"Unable to fit {item} on {ship.name}")
    return fit


def calculate(fit):
    import eos.db
    from eos.saveddata.character import Character
    from eos.saveddata.damagePattern import DamagePattern

    fit.character = Character.getAll5()
    fit.damagePattern = DamagePattern.getDefaultBuiltin()
    fit.factorReload = False
    fit.implantLocation = 0
    eos.db.saveddata_session.add(fit)
    eos.db.flush()
    fit.clear()
    fit.calculateModifiedAttributes()

    # EFT lists the bay contents. Use the first available flight in export order.
    bandwidth = fit.ship.getModifiedItemAttr('droneBandwidth') or 0
    count = int(fit.extraAttributes['maxActiveDrones'])
    for drone in fit.drones:
        cost = drone.getModifiedItemAttr('droneBandwidthUsed') or 0
        drone.amountActive = min(count, drone.amount, int(bandwidth // cost) if cost else drone.amount)
        count -= drone.amountActive
        bandwidth -= cost * drone.amountActive
    if fit.activeDrones:
        fit.clear()
        fit.calculateModifiedAttributes()


def stats(fit):
    from eos.const import FittingHardpoint

    turret_dps = missile_dps = 0
    ranges = {}
    for module in fit.activeModulesIter():
        dps = module.getDps().total
        if module.hardpoint == FittingHardpoint.TURRET:
            turret_dps += dps
        elif module.hardpoint == FittingHardpoint.MISSILE:
            missile_dps += dps
        if dps > 0:
            ranges.setdefault(module.item.name, {
                'optimal': module.maxRange or 0,
                'falloff': module.falloff or 0,
            })

    remote = fit.getRemoteReps()
    return {
        'shipTypeName': fit.ship.name,
        'dps': {
            'total': fit.getTotalDps().total,
            'turret': turret_dps,
            'missile': missile_dps,
            'drone': fit.getDroneDps().total,
        },
        'volley': fit.getTotalVolley().total,
        'remoteRepair': {name: getattr(remote, name) for name in ('armor', 'shield', 'hull', 'capacitor')},
        'ehp': sum(fit.ehp.values()),
        'maxVelocity': fit.maxSpeed,
        'ranges': ranges,
    }


def compute(payload_json):
    import eos.db

    parsed, drones = json.loads(payload_json)
    try:
        fit = fit_from_eft(parsed, drones)
        calculate(fit)
        outcome = {'ok': True, 'stats': stats(fit)}
    except BadEft as error:
        outcome = {'ok': False, 'message': str(error)}
    finally:
        eos.db.saveddata_session.rollback()
    return json.dumps(outcome, allow_nan=False)
