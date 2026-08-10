const Applet = imports.ui.applet;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Util = imports.misc.util;
const PopupMenu = imports.ui.popupMenu;
const UPowerGlib = imports.gi.UPowerGlib;
const Settings = imports.ui.settings;
const Calendar = require('./calendar');
const EventView = require('./eventView');
const CinnamonDesktop = imports.gi.CinnamonDesktop;
const Main = imports.ui.main;
const DateUtils = require('./modules/date-utils');

const DAY_FORMAT = CinnamonDesktop.WallClock.lctime_format("cinnamon", "%A");
const DATE_FORMAT_SHORT = CinnamonDesktop.WallClock.lctime_format("cinnamon", _("%B %-e, %Y"));
const DATE_FORMAT_FULL = CinnamonDesktop.WallClock.lctime_format("cinnamon", _("%A, %B %-e, %Y"));

class CinnamonCalendarApplet extends Applet.TextApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        
        // Tracking cleanup IDs
        this._desktopSettingsIds = [];
        this.clock_notify_id = 0;
        this._upClientNotifyId = 0;
        this._signalHandlers = [];

        try {
            this.orientation = orientation;
            this.desktop_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.interface" });
            this.settings = new Settings.AppletSettings(this, "jalalicalendar@daniel-pm", this.instance_id);
            this.clock = new CinnamonDesktop.WallClock();
            
            // Events Manager
            this.events_manager = new EventView.EventsManager(this.settings, this.desktop_settings);
            
            this._initContextMenu();
            this._initUI();
            this._initSettings();
            this._initPowerEvents();
            
        } catch (e) {
            global.logError(`[Jalali Calendar] Initialization Error: ${e.message}`);
        }
    }

    _initContextMenu() {
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, this.orientation);
        this.menuManager.addMenu(this.menu);

        // Select today on menu open
        this._connectSignal(this.menu, 'open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._resetCalendar();
                this.events_manager.select_date(this._calendar.getSelectedDate(), true);
            }
        });
    }

    _initUI() {
        let box = new St.BoxLayout({ style_class: 'calendar-main-box', vertical: false });
        this.menu.addActor(box);

        this.event_list = this.events_manager.get_event_list();
        this._connectSignal(this.event_list, "launched-calendar", () => this.menu.toggle());
        
        // Pass events to allow scrolling
        this._connectSignal(this.event_list, "start-pass-events", () => { this.menu.passEvents = true; });
        this._connectSignal(this.event_list, "stop-pass-events", () => { this.menu.passEvents = false; });
        box.add_actor(this.event_list.actor);

        let calbox = new St.BoxLayout({ vertical: true });
        
        this.go_home_button = new St.BoxLayout({
            style_class: "calendar-today-home-button",
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            vertical: true
        });

        this._connectSignal(this.go_home_button, "enter-event", (actor) => actor.add_style_pseudo_class("hover"));
        this._connectSignal(this.go_home_button, "leave-event", (actor) => actor.remove_style_pseudo_class("hover"));
        this._connectSignal(this.go_home_button, "button-press-event", (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) return Clutter.EVENT_STOP;
        });
        this._connectSignal(this.go_home_button, "button-release-event", (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                actor.remove_style_pseudo_class("hover");
                this._resetCalendar();
                return Clutter.EVENT_STOP;
            }
        });

        calbox.add_actor(this.go_home_button);

        this._day = new St.Label({ style_class: "calendar-today-day-label" });
        this._date = new St.Label({ style_class: "calendar-today-date-label" });
        this.go_home_button.add_actor(this._day);
        this.go_home_button.add_actor(this._date);

        this._calendar = new Calendar.Calendar(this.settings, this.events_manager);
        this._connectSignal(this._calendar, "selected-date-changed", () => this._updateClockAndDate());
        calbox.add_actor(this._calendar.actor);

        box.add_actor(calbox);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let item = new PopupMenu.PopupMenuItem(_("Date and Time Settings"));
        this._connectSignal(item, "activate", () => this._onLaunchSettings());
        this.menu.addMenuItem(item);

        // Hover events for tooltip logic
        this._is_entered = false;
        this._connectSignal(this.actor, 'enter-event', () => {
            this._is_entered = true;
            this._updateFormatString();
        });
        this._connectSignal(this.actor, 'leave-event', () => {
            this._is_entered = false;
            this._updateFormatString();
        });
    }

    _initSettings() {
        this.settings.bind("show-events", "show_events", this._onSettingsChanged.bind(this));
        this.settings.bind("use-custom-format", "use_custom_format", this._onSettingsChanged.bind(this));
        this.bindCustomSettings();
        this.settings.bind("keyOpen", "keyOpen", this._setKeybinding.bind(this));
        this._setKeybinding();

        this._desktopSettingsIds.push(this.desktop_settings.connect("changed::clock-use-24h", () => this._onSettingsChanged()));
        this._desktopSettingsIds.push(this.desktop_settings.connect("changed::clock-show-seconds", () => this._onSettingsChanged()));
        this._desktopSettingsIds.push(this.desktop_settings.connect("changed::clock-show-date", () => this._onSettingsChanged()));

        this._connectSignal(this.events_manager, "events-manager-ready", this._events_manager_ready.bind(this));
        this._connectSignal(this.events_manager, "has-calendars-changed", this._has_calendars_changed.bind(this));
    }

    bindCustomSettings() {
        this.settings.bind("custom-format", "custom_format", this._onSettingsChanged.bind(this));
        this.settings.bind("custom-tooltip-format", "custom_tooltip_format", this._onSettingsChanged.bind(this));
    }

    _initPowerEvents() {
        this._upClient = new UPowerGlib.Client();
        try {
            this._upClientNotifyId = this._upClient.connect('notify-resume', () => this._updateClockAndDate());
        } catch (e) {
            this._upClientNotifyId = this._upClient.connect('notify::resume', () => this._updateClockAndDate());
        }
    }

    _connectSignal(obj, signal, callback) {
        let id = obj.connect(signal, callback);
        this._signalHandlers.push({ obj: obj, id: id });
        return id;
    }

    _setKeybinding() {
        Main.keybindingManager.addXletHotKey(this, "calendar-open", this.keyOpen, () => this._openMenu());
    }

    _clockNotify() {
        this._updateClockAndDate();
    }

    on_applet_clicked() {
        this._openMenu();
    }

    _openMenu() {
        this.menu.toggle();
    }

    _onSettingsChanged() {
        this._updateFormatString();
        this._updateClockAndDate();
        this.event_list.actor.visible = this.events_manager.is_active();
        this.events_manager.select_date(this._calendar.getSelectedDate(), true);
    }

    on_custom_format_button_pressed() {
        Util.spawnCommandLine("xdg-open https://cinnamon-spices.linuxmint.com/strftime.php");
    }

    _onLaunchSettings() {
        this.menu.close();
        Util.spawnCommandLine("cinnamon-settings calendar");
    }

    _updateFormatString() {
        let in_vertical_panel = (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT);

        if (this.use_custom_format) {
            let custom_format = this.custom_format;
            if (this._is_entered) {
                custom_format += this.custom_tooltip_format;
            }

            if (!this.clock.set_format_string(custom_format)) {
                global.logError("[Jalali Calendar] Bad time format string");
                this.clock.set_format_string("~CLOCK FORMAT ERROR~ %l:%M %p");
            }
        } else if (in_vertical_panel) {
            let use_24h = this.desktop_settings.get_boolean("clock-use-24h");
            let show_seconds = this.desktop_settings.get_boolean("clock-show-seconds");

            let fmt = use_24h ? "%H%n%M" : "%l%n%M";
            if (show_seconds) fmt += "%n%S";
            else fmt += "%";

            this.clock.set_format_string(fmt);
        } else {
            this.clock.set_format_string(null);
        }
    }

    _events_manager_ready() {
        this.event_list.actor.visible = this.events_manager.is_active();
        this.events_manager.select_date(this._calendar.getSelectedDate(), true);
    }

    _has_calendars_changed() {
        this.event_list.actor.visible = this.events_manager.is_active();
    }

    _updateClockAndDate() {
        let now = new DateUtils.JDate();
        let label_string;

        if (this.use_custom_format) {
            let format = this._is_entered ? this.custom_format + this.custom_tooltip_format : this.custom_format;
            label_string = DateUtils.toLocaleFormat(now, format);
        } else {
            let in_vertical_panel = (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT);
            let use_24h = this.desktop_settings.get_boolean("clock-use-24h");
            let show_seconds = this.desktop_settings.get_boolean("clock-show-seconds");
            let show_date = this.desktop_settings.get_boolean("clock-show-date");
            
            let format = "";
            if (show_date && !in_vertical_panel) format += "%a %e %b ";
            
            if (use_24h) format += show_seconds ? "%H:%M:%S" : "%H:%M";
            else format += show_seconds ? "%l:%M:%S %p" : "%l:%M %p";
            
            if (in_vertical_panel) format = format.replace(":", "%n");
            
            label_string = DateUtils.toLocaleFormat(now, format);
        }

        this.go_home_button.reactive = !this._calendar.todaySelected();
        if (this._calendar.todaySelected()) {
            this.go_home_button.reactive = false;
            this.go_home_button.set_style_class_name("calendar-today-home-button");
        } else {
            this.go_home_button.reactive = true;
            this.go_home_button.set_style_class_name("calendar-today-home-button-enabled");
        }

        this.set_applet_label(label_string);

        let dateFormattedTooltip = this.clock.get_clock_for_format(DATE_FORMAT_FULL).capitalize();
        if (this.use_custom_format) {
            dateFormattedTooltip = this.clock.get_clock_for_format(this.custom_tooltip_format).capitalize();
            if (!dateFormattedTooltip) {
                dateFormattedTooltip = this.clock.get_clock_for_format("~CLOCK FORMAT ERROR~ %l:%M %p");
            }
        }

        let farsiDateStr = DateUtils.toLocaleFormat(now, "%A %e %B %Y");
        let islamicDateStr = DateUtils.getIslamicDateString(now);
        let multiCalendarTooltip = `خورشیدی: ${DateUtils.farsiNumbers(farsiDateStr)}\nقمری: ${islamicDateStr}\nمیلادی: ${dateFormattedTooltip}`;

        this._day.set_text(DateUtils.FARSI_DAY_NAMES[now.getDay()]);
        let jalaliShort = DateUtils.farsiNumbers(`${now.getDate()} ${DateUtils.FARSI_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`);
        this._date.set_text(jalaliShort);
        
        if (this._lastTooltip !== multiCalendarTooltip) {
            this.set_applet_tooltip(multiCalendarTooltip);
            this._lastTooltip = multiCalendarTooltip;
        }

        this.events_manager.select_date(this._calendar.getSelectedDate());
    }

    on_applet_added_to_panel() {
        this._onSettingsChanged();

        if (this.clock_notify_id === 0) {
            this.clock_notify_id = this.clock.connect("notify::clock", () => this._clockNotify());
        }

        this.events_manager.start_events();
        this._resetCalendar();
    }

    on_applet_removed_from_panel() {
        Main.keybindingManager.removeXletHotKey(this, "calendar-open");
        
        if (this.clock_notify_id > 0) {
            this.clock.disconnect(this.clock_notify_id);
            this.clock_notify_id = 0;
        }
        if (this._desktopSettingsIds) {
            this._desktopSettingsIds.forEach(id => this.desktop_settings.disconnect(id));
            this._desktopSettingsIds = [];
        }
        if (this._upClientNotifyId > 0) {
            this._upClient.disconnect(this._upClientNotifyId);
            this._upClientNotifyId = 0;
        }
        
        for (let handler of this._signalHandlers) {
            if (handler.obj && handler.id) {
                handler.obj.disconnect(handler.id);
            }
        }
        this._signalHandlers = [];

        if (this.events_manager) {
            this.events_manager.destroy();
        }
        if (this._calendar) {
            this._calendar.destroy();
        }
    }

    _resetCalendar() {
        this._calendar.setDate(new DateUtils.JDate(), true);
    }

    on_orientation_changed(orientation) {
        this.orientation = orientation;
        this.menu.setOrientation(orientation);
        this._onSettingsChanged();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CinnamonCalendarApplet(orientation, panel_height, instance_id);
}
