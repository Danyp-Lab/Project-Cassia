// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Signals = imports.signals;
const Pango = imports.gi.Pango;
const Cinnamon = imports.gi.Cinnamon;
const Settings = imports.ui.settings;
const Atk = imports.gi.Atk;
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Separator = imports.ui.separator;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const DateUtils = require('./modules/date-utils');

const STATUS_UNKNOWN = 0;
const STATUS_NO_CALENDARS = 1;
const STATUS_HAS_CALENDARS = 2;
const EDS_BUS_NAME = "org.gnome.evolution.dataserver.Calendar8";
const ARROW_SEPARATOR = "  ►  ";
const DAY_FORMAT = CinnamonDesktop.WallClock.lctime_format("cinnamon", "%A");

// ============================================================================
// Custom Jalali/Hijri Events Manager
// ============================================================================
const CustomEvents = {
    shamsiEvents: [],
    hijriEvents: [],
    loaded: false,

    async loadAsync() {
        if (this.loaded) return;
        try {
            let appletDir = imports.ui.appletManager.appletMeta['jalalicalendar@daniel-pm'].path;
            
            const loadJson = async (filename) => {
                return new Promise((resolve, reject) => {
                    let file = Gio.File.new_for_path(appletDir + '/data/' + filename);
                    file.load_contents_async(null, (obj, res) => {
                        try {
                            let [success, contents] = obj.load_contents_finish(res);
                            if (success) {
                                let decoder = new TextDecoder("utf-8");
                                resolve(JSON.parse(decoder.decode(contents)).events);
                            } else {
                                resolve([]);
                            }
                        } catch (e) {
                            global.logWarning(`[Jalali Calendar] Error loading ${filename}: ${e.message}`);
                            resolve([]);
                        }
                    });
                });
            };

            this.shamsiEvents = await loadJson('sevents.json');
            this.hijriEvents = await loadJson('mevents.json');
            this.loaded = true;
        } catch (e) {
            global.logWarning(`[Jalali Calendar] Critical error loading custom events: ${e.message}`);
        }
    }
};

class CustomEventData {
    constructor(type, ev, gdate) {
        this.id = `${type}-${gdate.to_unix()}-${ev.description.substring(0, 10)}`;
        this.summary = ev.description;
        this.color = ev.ishollyday ? "#e53935" : "#4fc3f7";
        this.all_day = true;
        this.start = gdate; 
        this.end = gdate;
        this.start_date = date_only(this.start);
        this.end_date = date_only(this.end);
        this.multi_day = false;
        this.span = 1;
        this.is_custom = true;
    }
}

// ============================================================================
// Utility Functions
// ============================================================================
function locale_cap(str) {
    if (!str) return str;
    return str.charAt(0).toLocaleUpperCase() + str.slice(1);
}

function js_date_to_gdatetime(js_date) {
    let unix = js_date.getTime() / 1000;
    return GLib.DateTime.new_from_unix_local(unix);
}

function date_only(gdatetime) {
    return GLib.DateTime.new_local(
        gdatetime.get_year(),
        gdatetime.get_month(),
        gdatetime.get_day_of_month(), 0, 0, 0
    );
}

function month_year_only(gdatetime) {
    return GLib.DateTime.new_local(
        gdatetime.get_year(),
        gdatetime.get_month(),
        1, 0, 0, 0
    );
}

function dt_equals(dt1, dt2) {
    if (!dt1 || !dt2) return false;
    return dt1.to_unix() === dt2.to_unix();
}

function format_timespan(timespan) {
    let minutes = Math.floor(timespan / GLib.TIME_SPAN_MINUTE);
    if (minutes < 10) return ["imminent", _("Starting in a few minutes")];
    if (minutes < 60) return ["soon", _("Starting in %d minutes").format(minutes)];
    let hours = Math.floor(minutes / 60);
    if (hours > 6) {
        let later = GLib.DateTime.new_now_local().add_hours(hours);
        return ["", later.get_hour() > 18 ? _("This evening") : _("Starting later today")];
    }
    return ["", ngettext("In %d hour", "In %d hours", hours).format(hours)];
}

// ============================================================================
// Event Data Classes
// ============================================================================
class EventData {
    constructor(data_var, last_update_timestamp) {
        const [id, color, summary, all_day, start_time, end_time, mod_time] = data_var.deep_unpack();
        this.id = id;
        this.start = GLib.DateTime.new_from_unix_local(start_time);
        this.end = GLib.DateTime.new_from_unix_local(end_time);
        this.all_day = all_day;
        
        if (this.all_day) {
            this.end = this.end.add_seconds(-1);
        }
        if (this.end.compare(this.start) === -1) {
            this.end = this.start;
        }
        
        this.start_date = date_only(this.start);
        this.end_date = date_only(this.end);
        this.multi_day = !dt_equals(this.start_date, this.end_date);
        this.span = this.multi_day ? (this.end_date.difference(this.start_date) / GLib.TIME_SPAN_DAY) : 1;
        this.summary = summary;
        this.color = color;
        this.modified = mod_time;
        this.last_update_timetamp = last_update_timestamp;
    }

    starts_on_day(date) { return dt_equals(date_only(date), this.start_date); }
    ends_on_day(date) { return dt_equals(date_only(date), this.end_date); }
    started_before_day(date) { return date_only(date).difference(this.start_date) > 0; }
    ended_before_day(date) { return date_only(date).difference(this.end_date) > 0; }
    ends_after_day(date) { return date_only(date).difference(this.end_date) < 0; }
    started_after_day(date) { return date_only(date).difference(this.start_date) < 0; }
    started_before_and_ends_after(date) { return this.multi_day && this.started_before_day(date) && this.ends_after_day(date); }
    equal(other_event) { return this.id === other_event.id && this.modified === other_event.modified; }
}

class EventDataList {
    constructor(gdate_only) {
        this.timestamp = GLib.get_monotonic_time();
        this.gdate_only = gdate_only;
        this.length = 0;
        this._events = {};
    }

    add_or_update(event_data, last_update_timetamp) {
        let existing = this._events[event_data.id];
        if (existing === undefined) this.length++;
        
        if (existing !== undefined && event_data.equal(existing)) {
            existing.last_update_timetamp = last_update_timetamp;
            existing.color = event_data.color;
            return false;
        }

        this._events[event_data.id] = event_data;
        this.timestamp = GLib.get_monotonic_time();
        return true;
    }

    delete(id) {
        if (this._events[id] === undefined) return false;
        this.length--;
        delete this._events[id];
        this.timestamp = GLib.get_monotonic_time();
        return true;
    }

    cull_removed_events(last_update_timetamp) {
        let to_remove = [];
        for (let id in this._events) {
            if (this._events[id].last_update_timetamp < last_update_timetamp) {
                to_remove.push(id);
            }
        }
        if (to_remove.length === 0) return false;
        to_remove.forEach((id) => this.delete(id));
        return true;
    }

    get_event_list() {
        let now = GLib.DateTime.new_now_local();
        let events_as_array = Object.values(this._events);

        events_as_array.sort((a, b) => a.start.to_unix() - b.start.to_unix());

        try {
            let unixMs = this.gdate_only.to_unix() * 1000;
            let jdate = new DateUtils.JDate(unixMs);
            let ny = new DateUtils.JDate(jdate.getFullYear(), 0, 1);
            let dayOfYearIndex = Math.floor((jdate.getTime() - ny.getTime()) / DateUtils.MSECS_IN_DAY);
            
            if (dayOfYearIndex >= 0 && dayOfYearIndex <= 366 && CustomEvents.shamsiEvents[dayOfYearIndex] && CustomEvents.shamsiEvents[dayOfYearIndex].description) {
                events_as_array.unshift(new CustomEventData("shamsi", CustomEvents.shamsiEvents[dayOfYearIndex], this.gdate_only));
            }

            let islamicParts = DateUtils.getIslamicDateParts(jdate.getNativeDate());
            if (!islamicParts.error) {
                let hijriIndex = DateUtils.getHijriEventIndex(islamicParts.month, islamicParts.day);
                if (CustomEvents.hijriEvents[hijriIndex] && CustomEvents.hijriEvents[hijriIndex].description) {
                    events_as_array.unshift(new CustomEventData("hijri", CustomEvents.hijriEvents[hijriIndex], this.gdate_only));
                }
            }
        } catch (e) {
            global.logError(e);
        }

        if (!dt_equals(date_only(now), this.gdate_only)) {
            return events_as_array;
        }

        let all_days = events_as_array.filter(e => e.all_day).reverse();
        let final_list = [];
        let all_days_inserted = false;

        for (let i = events_as_array.length - 1; i >= 0; i--) {
            let event = events_as_array[i];
            if (event.all_day && all_days_inserted) break;
            
            if (event.end.difference(now) < 0 && !all_days_inserted) {
                final_list.push(...all_days);
                all_days_inserted = true;
            }
            final_list.push(event);
        }
        
        final_list.reverse();
        return final_list;
    }

    get_colors() {
        return this.get_event_list().map(e => e.color);
    }
}

// ============================================================================
// EventsManager
// ============================================================================
class EventsManager {
    constructor(settings, desktop_settings) {
        this.settings = settings;
        this.desktop_settings = desktop_settings;
        this._bus_watch_id = 0;
        this._calendar_server = null;
        this.current_month_year = null;
        this.current_selected_date = GLib.DateTime.new_from_unix_local(0);
        this.last_update_timestamp = 0;
        this.events_by_date = {};
        this._inited = false;
        this._cached_state = STATUS_UNKNOWN;
        this._gc_timer_id = 0;
        this._reload_today_id = 0;
        this._calendar_server_signals = [];
        this._event_list = null;

        CustomEvents.loadAsync();
    }

    destroy() {
        if (this._bus_watch_id > 0) {
            Gio.bus_unwatch_name(this._bus_watch_id);
            this._bus_watch_id = 0;
        }
        if (this._calendar_server) {
            for (let id of this._calendar_server_signals) {
                this._calendar_server.disconnect(id);
            }
            this._calendar_server_signals = [];
        }
        this._stop_gc_timer();
        this._cancel_reload_today();
        if (this._event_list) {
            this._event_list.destroy();
            this._event_list = null;
        }
    }

    start_events() {
        this._bus_watch_id = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            EDS_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            this.eds_service_found.bind(this),
            null
        );
    }

    eds_service_found() {
        Gio.bus_unwatch_name(this._bus_watch_id);
        this._bus_watch_id = 0;

        if (this._calendar_server == null) {
            Cinnamon.CalendarServerProxy.new_for_bus(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION,
                "org.cinnamon.CalendarServer",
                "/org/cinnamon/CalendarServer",
                null,
                this._calendar_server_ready.bind(this)
            );
        }
    }

    _calendar_server_ready(obj, res) {
        try {
            this._calendar_server = Cinnamon.CalendarServerProxy.new_for_bus_finish(res);

            this._calendar_server_signals.push(this._calendar_server.connect("events-added-or-updated", this._handle_added_or_updated_events.bind(this)));
            this._calendar_server_signals.push(this._calendar_server.connect("events-removed", this._handle_removed_events.bind(this)));
            this._calendar_server_signals.push(this._calendar_server.connect("client-disappeared", this._handle_client_disappeared.bind(this)));
            this._calendar_server_signals.push(this._calendar_server.connect("notify::status", this._handle_status_notify.bind(this)));

            this._inited = true;
            this.emit("events-manager-ready");
        } catch (e) {
            global.logWarning("[Jalali Calendar] Could not connect to calendar server process: " + e);
        }
    }

    _stop_gc_timer() {
        if (this._gc_timer_id > 0) {
            Mainloop.source_remove(this._gc_timer_id);
            this._gc_timer_id = 0;
        }
    }

    _start_gc_timer() {
        this._stop_gc_timer();
        if (!this.is_active()) return;
        this._gc_timer_id = Mainloop.timeout_add_seconds(3, () => this._perform_gc());
    }

    _perform_gc() {
        let any_removed = false;
        for (let date in this.events_by_date) {
            if (this.events_by_date[date].cull_removed_events(this.last_update_timestamp)) {
                any_removed = true;
            }
        }
        if (any_removed) {
            this._event_list.set_events(this.events_by_date[this.current_selected_date.to_unix()] || null);
            this.emit("events-updated");
        }
        this._gc_timer_id = 0;
        return GLib.SOURCE_REMOVE;
    }

    _handle_added_or_updated_events(server, varray) {
        let changed = false;
        let events = varray.unpack();
        
        for (let n = 0; n < events.length; n++) {
            let data = new EventData(events[n], this.last_update_timestamp);
            let escape = 0;
            let date_iter = date_only(data.start);
            
            do {
                let hash = date_iter.to_unix();
                if (this.events_by_date[hash] === undefined) {
                    this.events_by_date[hash] = new EventDataList(date_iter);
                }
                if (this.events_by_date[hash].add_or_update(data, this.last_update_timestamp)) {
                    if (dt_equals(date_iter, this.current_selected_date)) changed = true;
                }
                if (data.ends_on_day(date_iter) || escape === 50) break;
                escape++;
                date_iter = date_iter.add_days(1);
            } while (true);
        }

        if (changed) {
            this._event_list.set_events(this.events_by_date[this.current_selected_date.to_unix()] || null);
        }
        this._start_gc_timer();
        this.emit("events-updated");
    }

    _handle_removed_events(server, uids_string) {
        let uids = uids_string.split("::");
        for (let hash in this.events_by_date) {
            for (let uid of uids) {
                this.events_by_date[hash].delete(uid);
            }
        }
        this.queue_reload_today(false);
        this.emit("events-updated");
    }

    _handle_client_disappeared() {
        this.events_by_date = {};
        this.queue_reload_today(true);
    }

    _handle_status_notify() {
        if (this._calendar_server.status === this._cached_state || this._calendar_server.status === STATUS_UNKNOWN) {
            return;
        }
        this._cached_state = this._calendar_server.status;
        this.queue_reload_today(true);
        this.emit("has-calendars-changed");
    }

    get_event_list() {
        if (this._event_list !== null) return this._event_list;
        this._event_list = new EventList(this.settings, this.desktop_settings);
        return this._event_list;
    }

    fetch_month_events(month_year, force) {
        let changed_month = this.current_month_year === null || !dt_equals(month_year, this.current_month_year);
        if (!changed_month && !force) return;

        this.current_month_year = month_year;
        if (changed_month) this.events_by_date = {};

        let day_one = month_year_only(month_year);
        let week_day = day_one.get_day_of_week();
        let week_start = Cinnamon.util_get_week_start();

        let start = day_one.add_days(-(week_day - week_start));
        let end = start.add_days(42).add_seconds(-1);

        this._calendar_server.call_set_time_range(
            start.to_unix(), end.to_unix(), force, null,
            (server, res) => {
                try {
                    this._calendar_server.call_set_time_range_finish(res);
                } catch (e) {
                    global.logWarning(`[Jalali Calendar] Error setting time range: ${e.message}`);
                }
            }
        );
        this.last_update_timestamp = GLib.get_monotonic_time();
    }

    _cancel_reload_today() {
        if (this._reload_today_id > 0) {
            Mainloop.source_remove(this._reload_today_id);
            this._reload_today_id = 0;
        }
    }

    queue_reload_today(force) {
        this._cancel_reload_today();
        if (force) this._force_reload_pending = true;
        
        this._reload_today_id = Mainloop.idle_add(() => {
            this._reload_today_id = 0;
            this.select_date(new Date(), this._force_reload_pending);
            this._force_reload_pending = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    select_date(date, force) {
        if (!this.is_active()) return;
        
        let gdate = js_date_to_gdatetime(date);
        let gdate_only = date_only(gdate);
        let month_year = month_year_only(gdate_only);
        
        this.fetch_month_events(month_year, force);
        this._event_list.set_date(gdate_only);

        let delay_no_events_box = this.current_selected_date === null || 
                                 !dt_equals(month_year_only(this.current_selected_date), month_year_only(gdate_only));
                                 
        this.current_selected_date = gdate_only;
        let existing_event_list = this.events_by_date[gdate_only.to_unix()];
        this._event_list.set_events(existing_event_list || null, delay_no_events_box);
    }

    get_colors_for_date(js_date) {
        let gdate_only = date_only(js_date_to_gdatetime(js_date));
        let event_data_list = this.events_by_date[gdate_only.to_unix()];
        return event_data_list !== undefined ? event_data_list.get_colors() : null;
    }

    is_active() {
        return this._inited &&
               this.settings.getValue("show-events") &&
               this._calendar_server !== null &&
               this._calendar_server.status !== STATUS_NO_CALENDARS;
    }
}
Signals.addSignalMethods(EventsManager.prototype);

// ============================================================================
// Event UI Elements
// ============================================================================
class EventList {
    constructor(settings, desktop_settings) {
        this.settings = settings;
        this.desktop_settings = desktop_settings;
        this.selected_date = GLib.DateTime.new_now_local();
        this._no_events_timeout_id = 0;
        this._scroll_to_idle_id = 0;
        this._rows = [];
        this._current_event_data_list_timestamp = 0;

        this.actor = new St.BoxLayout({ style_class: "calendar-events-main-box", vertical: true, visible: false });

        this.selected_date_label = new St.Label({ style_class: "calendar-events-date-label", reactive: true });
        this.selected_date_label.connect("button-press-event", (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this.launch_calendar(this.selected_date);
                return Clutter.EVENT_STOP;
            }
        });
        this.actor.add_actor(this.selected_date_label);

        this.no_events_box = new St.BoxLayout({
            style_class: "calendar-events-no-events-box",
            vertical: true, visible: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, y_expand: true
        });

        this.no_events_button = new St.Button({
            style_class: "calendar-events-no-events-button",
            reactive: GLib.find_program_in_path("gnome-calendar")
        });
        this.no_events_button.connect('clicked', () => this.launch_calendar(this.selected_date));

        let button_inner_box = new St.BoxLayout({ vertical: true });
        let no_events_icon = new St.Icon({
            style_class: "calendar-events-no-events-icon",
            icon_name: 'xsi-x-office-calendar',
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 48
        });
        let no_events_label = new St.Label({
            style_class: "calendar-events-no-events-label",
            text: _("No Events"),
            y_align: Clutter.ActorAlign.CENTER
        });

        button_inner_box.add_actor(no_events_icon);
        button_inner_box.add_actor(no_events_label);
        this.no_events_button.add_actor(button_inner_box);
        this.no_events_box.add_actor(this.no_events_button);
        this.actor.add_actor(this.no_events_box);

        this.events_box = new St.BoxLayout({
            style_class: 'calendar-events-event-container',
            vertical: true,
            accessible_role: Atk.Role.LIST
        });
        this.events_scroll_box = new St.ScrollView({
            style_class: 'calendar-events-scrollbox vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_auto_scrolling: true
        });

        let vscroll = this.events_scroll_box.get_vscroll_bar();
        vscroll.connect('scroll-start', () => this.emit("start-pass-events"));
        vscroll.connect('scroll-stop', () => this.emit("stop-pass-events"));

        this.events_scroll_box.add_actor(this.events_box);
        this.actor.add_actor(this.events_scroll_box);
    }

    destroy() {
        if (this._no_events_timeout_id > 0) {
            Mainloop.source_remove(this._no_events_timeout_id);
            this._no_events_timeout_id = 0;
        }
        if (this._scroll_to_idle_id > 0) {
            Mainloop.source_remove(this._scroll_to_idle_id);
            this._scroll_to_idle_id = 0;
        }
    }

    launch_calendar(gdate) {
        Util.trySpawn(["gnome-calendar", "--date", gdate.format("%x")], false);
        this.emit("launched-calendar");
    }

    set_date(gdate) {
        let unixMs = gdate.to_unix() * 1000;
        let jdate = new DateUtils.JDate(unixMs);
        let jalaliDateStr = `${DateUtils.FARSI_DAY_NAMES[jdate.getDay()]} ${jdate.getDate()} ${DateUtils.FARSI_MONTH_NAMES[jdate.getMonth()]} ${jdate.getFullYear()}`;
        this.selected_date_label.set_text(DateUtils.farsiNumbers(jalaliDateStr));
        this.selected_date = gdate;
    }

    set_events(event_data_list, delay_no_events_box) {
        if (this._scroll_to_idle_id > 0) {
            Mainloop.source_remove(this._scroll_to_idle_id);
            this._scroll_to_idle_id = 0;
        }

        if (event_data_list !== null && event_data_list.timestamp === this._current_event_data_list_timestamp) {
            this._rows.forEach((row) => row.update_variations());
            return;
        }

        this.events_box.get_children().forEach((actor) => {
            this.events_box.remove_actor(actor);
            Mainloop.idle_add(() => {
                if (actor) actor.destroy();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._rows = [];

        if (this._no_events_timeout_id > 0) {
            Mainloop.source_remove(this._no_events_timeout_id);
            this._no_events_timeout_id = 0;
        }

        if (event_data_list === null) {
            if (delay_no_events_box) {
                this._no_events_timeout_id = Mainloop.timeout_add(600, () => {
                    this._no_events_timeout_id = 0;
                    this.no_events_box.show();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this.no_events_box.show();
            }
            this._current_event_data_list_timestamp = 0;
            return;
        }

        this.no_events_box.hide();
        this._current_event_data_list_timestamp = event_data_list.timestamp;
        let events = event_data_list.get_event_list();
        let scroll_to_row = null;
        let first_row_done = false;

        for (let event_data of events) {
            if (first_row_done) {
                this.events_box.add_actor(new Separator.Separator().actor);
            }

            let row = new EventRow(event_data, this.selected_date, { use_24h: this.desktop_settings.get_boolean("clock-use-24h") });
            row.connect("view-event", (row, uuid) => {
                this.emit("launched-calendar");
                Util.trySpawn(["gnome-calendar", "--uuid", uuid], false);
            });

            this.events_box.add_actor(row.actor);
            first_row_done = true;
            if (row.is_current_or_next && scroll_to_row === null) scroll_to_row = row;
            this._rows.push(row);
        }

        if (scroll_to_row == null) return;

        this._scroll_to_idle_id = Mainloop.idle_add(() => {
            let vscroll = this.events_scroll_box.get_vscroll_bar();
            if (scroll_to_row != null) {
                let mid_position = scroll_to_row.actor.y + (scroll_to_row.actor.height / 2) - (this.events_box.height / 2);
                vscroll.get_adjustment().set_value(mid_position);
            } else {
                vscroll.get_adjustment().set_value(0);
            }
            this._scroll_to_idle_id = 0;
            return GLib.SOURCE_REMOVE;
        });
    }
}
Signals.addSignalMethods(EventList.prototype);

class EventRow {
    constructor(event, date, params) {
        this.event = event;
        this.is_current_or_next = false;
        this.selected_date = date;
        this.use_24h = params.use_24h;

        this.actor = new St.BoxLayout({ style_class: "calendar-event-button", reactive: true });
        this.actor.connect("enter-event", () => this.actor.add_style_pseudo_class("hover"));
        this.actor.connect("leave-event", () => this.actor.remove_style_pseudo_class("hover"));

        if (GLib.find_program_in_path("gnome-calendar")) {
            this.actor.connect("button-press-event", (actor, event_evt) => {
                if (event_evt.get_button() === Clutter.BUTTON_PRIMARY) {
                    this.emit("view-event", this.event.id);
                    return Clutter.EVENT_STOP;
                }
            });
        }

        let color_strip = new St.Bin({
            style_class: "calendar-event-color-strip",
            style: `background-color: ${event.color};`
        });
        this.actor.add(color_strip);

        let vbox = new St.BoxLayout({ style_class: "calendar-event-row-content", x_expand: true, vertical: true });
        this.actor.add_actor(vbox);

        let label_box = new St.BoxLayout({ name: "label-box", x_expand: true });
        vbox.add_actor(label_box);

        this.event_time = new St.Label({ x_align: Clutter.ActorAlign.START, text: "", style_class: "calendar-event-time-present" });
        label_box.add(this.event_time, { expand: true, x_fill: true });

        this.countdown_label = new St.Label({ x_align: Clutter.ActorAlign.END, style_class: "calendar-event-countdown" });
        label_box.add(this.countdown_label, { expand: true, x_fill: true });

        let event_summary = new St.Label({
            text: this.event.summary,
            y_expand: true,
            style_class: "calendar-event-summary"
        });
        event_summary.get_clutter_text().line_wrap = true;
        event_summary.get_clutter_text().ellipsize = Pango.EllipsizeMode.NEVER;
        vbox.add(event_summary, { expand: true });

        this.update_variations();
    }

    update_variations() {
        let time_until_start = this.event.start.difference(GLib.DateTime.new_now_local());
        let time_until_finish = this.event.end.difference(GLib.DateTime.new_now_local());
        let today = date_only(GLib.DateTime.new_now_local());
        let selected_is_today = dt_equals(today, this.selected_date);
        let starts_today = dt_equals(today, this.event.start_date);

        if (time_until_finish < 0) {
            this.event_time.set_style_class_name("calendar-event-time-past");
            this.countdown_label.set_text("");
        } else if (time_until_start > 0) {
            this.event_time.set_style_class_name("calendar-event-time-future");
            if (starts_today) {
                let [countdown_pclass, text] = format_timespan(time_until_start);
                this.countdown_label.set_text(text);
                this.countdown_label.add_style_pseudo_class(countdown_pclass);
                this.is_current_or_next = !this.event.all_day;
            } else {
                this.countdown_label.set_text("");
            }
        } else {
            this.event_time.set_style_class_name("calendar-event-time-present");
            if (this.event.all_day || this.event.multi_day) {
                this.countdown_label.set_text("");
                this.event_time.set_style_pseudo_class("all-day");
            } else {
                this.countdown_label.set_text(_("In progress"));
                this.countdown_label.set_style_pseudo_class("current");
            } 
            this.is_current_or_next = this.event.is_today && !this.event.all_day;
        }

        let time_format = this.use_24h ? "%H:%M" : "%-l:%M %p";
        let final_str = "";

        if (this.event.starts_on_day(this.selected_date) && !this.event.multi_day) {
            if (this.event.all_day) {
                final_str += _("All day");
            } else {
                final_str += this.event.start.format(time_format) + ARROW_SEPARATOR + this.event.end.format(time_format);
            }
            this.event_time.set_text(final_str);
            return;
        }

        if (this.event.multi_day && this.event.ended_before_day(today)) {
            final_str += this.event.start_date.format("%x") + ARROW_SEPARATOR + this.event.end_date.format("%x");
            this.event_time.set_text(final_str);
            return;
        }

        if (selected_is_today) {
            if (this.event.starts_on_day(this.selected_date)) {
                final_str += this.event.all_day ? _("Today") : this.event.start.format(time_format);
            } else if (this.event.started_before_day(this.selected_date)) {
                if (this.event.started_after_day(this.selected_date.add_days(-4))) {
                    final_str += locale_cap(this.event.start_date.format(DAY_FORMAT));
                } else {
                    final_str += this.event.start_date.format("%x");
                }
            }
            final_str += ARROW_SEPARATOR;
            if (this.event.ends_on_day(this.selected_date)) {
                final_str += this.event.all_day ? _("Today") : this.event.end.format(time_format);
            } else if (this.event.ends_after_day(this.selected_date.add_days(4))) {
                final_str += this.event.end_date.format("%x");
            } else {
                final_str += locale_cap(this.event.end_date.format(DAY_FORMAT));
            }
        } else {
            if (this.event.started_before_day(today)) {
                if (this.event.started_after_day(today.add_days(-4))) {
                    final_str += locale_cap(this.event.start_date.format(DAY_FORMAT));
                } else {
                    if (this.event.starts_on_day(this.selected_date) && !this.event.all_day) {
                        final_str += this.event.start.format(time_format);
                    } else {
                        final_str += this.event.start_date.format("%x");
                    }
                }
            } else {
                if (this.event.starts_on_day(today)) {
                    if (!this.event.all_day) final_str += this.event.start.format(time_format) + " ";
                    final_str += _("Today");
                } else {
                    if (this.event.started_before_day(today.add_days(4))) {
                        final_str += this.event.start_date.format(DAY_FORMAT);
                    } else {
                        final_str += this.event.start_date.format("%x");
                    }
                }
            }
            final_str += ARROW_SEPARATOR;
            if (this.event.ends_on_day(today)) {
                if (!this.event.all_day) final_str += this.event.end.format(time_format) + " ";
                final_str += _("Today");
            } else if (this.event.ends_on_day(this.selected_date) && !this.event.all_day) {
                final_str += this.event.end.format(time_format);
            } else if (this.event.ends_after_day(today.add_days(4))) {
                final_str += this.event.end_date.format("%x");
            } else {
                final_str += locale_cap(this.event.end_date.format(DAY_FORMAT));
            }
        }
        this.event_time.set_text(final_str);
    }
}
Signals.addSignalMethods(EventRow.prototype);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventsManager };
}
