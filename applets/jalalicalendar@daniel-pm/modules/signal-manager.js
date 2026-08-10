/**
 * @file signal-manager.js
 * @description Lifecycle manager for signals, timeouts, and DBus watches.
 */

const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const Logger = require('./modules/logger');

class SignalManager {
    #signals = [];
    #timeouts = [];
    #busWatches = [];
    #isDestroyed = false;

    /**
     * Connect a GObject signal and track it for cleanup.
     * @param {Object} obj - The GObject.
     * @param {string} signal - The signal name.
     * @param {function} callback - The callback function.
     * @returns {number} The signal connection ID.
     */
    connectSignal(obj, signal, callback) {
        if (this.#isDestroyed) return 0;
        try {
            const id = obj.connect(signal, callback);
            this.#signals.push({ obj, id });
            return id;
        } catch (e) {
            Logger.error(`Failed to connect signal '${signal}'`, e);
            return 0;
        }
    }

    /**
     * Add a Mainloop timeout/idle function and track it.
     * @param {function} fn - The Mainloop add function (e.g. Mainloop.timeout_add).
     * @param {...any} args - Arguments to pass to the function.
     * @returns {number} The source ID.
     */
    addTimeout(fn, ...args) {
        if (this.#isDestroyed) return 0;
        const id = fn(...args);
        this.#timeouts.push(id);
        return id;
    }

    removeTimeout(id) {
        if (id > 0) {
            Mainloop.source_remove(id);
            this.#timeouts = this.#timeouts.filter(tId => tId !== id);
        }
    }

    /**
     * Watch a DBus name and track the watch ID.
     */
    watchBusName(busType, name, flags, nameAppearedClosure, nameVanishedClosure) {
        if (this.#isDestroyed) return 0;
        const id = Gio.bus_watch_name(busType, name, flags, nameAppearedClosure, nameVanishedClosure);
        this.#busWatches.push(id);
        return id;
    }

    removeBusWatch(id) {
        if (id > 0) {
            Gio.bus_unwatch_name(id);
            this.#busWatches = this.#busWatches.filter(wId => wId !== id);
        }
    }

    /**
     * Disconnects all tracked signals, timeouts, and bus watches.
     */
    destroy() {
        this.#isDestroyed = true;
        
        for (const { obj, id } of this.#signals) {
            if (obj && id) {
                try {
                    obj.disconnect(id);
                } catch (e) {
                    // Ignore disconnect errors if object is already destroyed
                }
            }
        }
        this.#signals = [];

        for (const id of this.#timeouts) {
            if (id > 0) Mainloop.source_remove(id);
        }
        this.#timeouts = [];

        for (const id of this.#busWatches) {
            if (id > 0) Gio.bus_unwatch_name(id);
        }
        this.#busWatches = [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SignalManager;
}
