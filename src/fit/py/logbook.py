# From pyfa-phone (GPL-3.0-or-later), adapted for the fit engine.
"""The subset of logbook used by the headless pyfa engine."""

import logging
from contextlib import AbstractContextManager
from logging import CRITICAL, DEBUG, ERROR, INFO, WARNING, NullHandler, StreamHandler
from logging.handlers import MemoryHandler, TimedRotatingFileHandler


class Logger:
    """Adapt logbook's braces-style formatting to standard logging."""

    def __init__(self, name):
        self._logger = logging.getLogger(name)
        if not self._logger.handlers:
            self._logger.addHandler(NullHandler())

    def _log(self, level, message, args, kwargs, *, exc_info=False):
        if self._logger.isEnabledFor(level):
            self._logger.log(level, str(message).format(*args, **kwargs) if args or kwargs else str(message),
                             exc_info=exc_info)

    def debug(self, message, *args, **kwargs):
        self._log(DEBUG, message, args, kwargs)

    def info(self, message, *args, **kwargs):
        self._log(INFO, message, args, kwargs)

    def warning(self, message, *args, **kwargs):
        self._log(WARNING, message, args, kwargs)

    warn = warning

    def error(self, message, *args, **kwargs):
        self._log(ERROR, message, args, kwargs)

    def exception(self, message, *args, **kwargs):
        self._log(ERROR, message, args, kwargs, exc_info=True)

    def critical(self, message, *args, **kwargs):
        self._log(CRITICAL, message, args, kwargs)


class FingersCrossedHandler(MemoryHandler):
    def __init__(self, handler, action_level=ERROR, buffer_size=100, **_):
        super().__init__(capacity=buffer_size, flushLevel=action_level, target=handler)


class NestedSetup(AbstractContextManager):
    def __init__(self, handlers):
        self.handlers = handlers

    def __enter__(self):
        for handler in self.handlers:
            logging.getLogger().addHandler(handler)
        return self

    def __exit__(self, *exc):
        for handler in self.handlers:
            logging.getLogger().removeHandler(handler)
