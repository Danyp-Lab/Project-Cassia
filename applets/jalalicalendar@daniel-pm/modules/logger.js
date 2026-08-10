/**
 * @file logger.js
 * @description Centralized logging utility for the Jalali Calendar applet.
 */

const PREFIX = "[Jalali Calendar]";

class Logger {
    static info(message) {
        global.log(`${PREFIX} ${message}`);
    }

    static warn(message) {
        global.logWarning(`${PREFIX} ${message}`);
    }

    static error(message, error = null) {
        let msg = `${PREFIX} ${message}`;
        if (error) {
            msg += ` | Error: ${error.message || error}`;
            if (error.stack) {
                msg += `\nStack: ${error.stack}`;
            }
        }
        global.logError(msg);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}
