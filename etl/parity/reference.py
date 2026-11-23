"""Calculate reference stats from pyfa's native EFT importer under CPython."""

import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

import logbook  # Resolve CPython's real logbook before adding the browser shim to sys.path.

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'vendor/pyfa'), str(ROOT / 'src/fit/py')]

import headless

headless.bootstrap(ROOT / 'build/eve.db')

import eos.db
from eos.const import FittingHardpoint
from eos.saveddata.character import Character
from eos.saveddata.damagePattern import DamagePattern
from service.port.eft import importEft


# EFT carries bay contents only. These are the expected first flights for the fixtures.
FLIGHTS = {'hurricane': {'Warrior II': 5}, 'oracle': {}, 'scimitar': {'Light Shield Maintenance Bot II': 5}}


def reference(name):
    text = (Path(__file__).parent / f'{name}.eft').read_text()
    fit = importEft(text.splitlines())
    assert fit is not None, name
    fit.character = Character.getAll5()
    fit.damagePattern = DamagePattern.getBuiltinById(-1)
    fit.factorReload = False
    fit.implantLocation = 0
    eos.db.saveddata_session.add(fit)
    eos.db.flush()
    for drone in fit.drones:
        drone.amountActive = FLIGHTS[name].get(drone.item.name, 0)
    fit.clear()
    fit.calculateModifiedAttributes()

    live_weapons = [module for module in fit.activeModulesIter() if module.getDps().total]
    # Reverse traversal makes the first fitted module authoritative for duplicate names.
    ranges = {
        mod.item.name: {'optimal': mod.maxRange or 0, 'falloff': mod.falloff or 0}
        for mod in reversed(live_weapons)
    }
    repairs = fit.getRemoteReps()
    result = {
        'shipTypeName': fit.ship.item.name,
        'dps': {
            'total': fit.getTotalDps().total,
            'turret': sum(mod.getDps().total for mod in live_weapons if mod.hardpoint == FittingHardpoint.TURRET),
            'missile': sum(mod.getDps().total for mod in live_weapons if mod.hardpoint == FittingHardpoint.MISSILE),
            'drone': fit.getDroneDps().total,
        },
        'volley': fit.getTotalVolley().total,
        'remoteRepair': dict(zip(('armor', 'shield', 'hull', 'capacitor'),
                                 (repairs.armor, repairs.shield, repairs.hull, repairs.capacitor))),
        'ehp': sum(fit.ehp.values()),
        'maxVelocity': fit.maxSpeed,
        'ranges': ranges,
    }
    eos.db.saveddata_session.rollback()
    return result


print(json.dumps({name: reference(name) for name in sys.argv[1:]}, allow_nan=False))
