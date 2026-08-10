// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Signals = imports.signals;
const Pango = imports.gi.Pango;
const Gettext_gtk30 = imports.gettext.domain('gtk30');
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const DateUtils = require('./modules/date-utils');
const Logger = require('./modules/logger');
const SignalManager = require('./modules/signal-manager');

const MSECS_IN_DAY = 24 * 60 * 60 * 1000;
const WEEKDATE_HEADER_WIDTH_DIGITS = 3;
const SHOW_WEEKDATE_KEY = 'show-week-numbers';
const DESKTOP_SCHEMA = 'org.cinnamon.desktop.interface';

function _sameDay(dateA, dateB) {
    return DateUtils.sameDay(dateA, dateB);
}

function _today(date) {
    let today = new DateUtils.JDate();
    return DateUtils.sameDay(date, today);
}

function _getDigitWidth(actor) {
    let context = actor.get_pango_context();
    let themeNode = actor.get_theme_node();
    let font = themeNode.get_font();
    let metrics = context.get_metrics(font, context.get_language());
    return metrics.get_approximate_digit_width();
}

class Calendar {
    constructor(settings, events_manager) {
        this.events_manager = events_manager;
        this._weekStart = 6; // Jalali calendar always starts on Saturday
        this._digitWidth = NaN;
        this.settings = settings;

        this.signals = new SignalManager();
        this._update_id = 0;
        this._set_date_idle_id = 0;

        this._dayCells = [];
        this._weekNumberCells = [];

        this.settings.bindWithObject(this, "show-week-numbers", "show_week_numbers", this._onSettingsChange);
        this.desktop_settings = new Gio.Settings({ schema_id: DESKTOP_SCHEMA });

        this.events_enabled = false;
        
        this.signals.connectSignal(this.events_manager, "events-updated", this._events_updated.bind(this));
        this.signals.connectSignal(this.events_manager, "events-manager-ready", this._update_events_enabled.bind(this));
        this.signals.connectSignal(this.events_manager, "has-calendars-changed", this._update_events_enabled.bind(this));

        let var_name = 'calendar:MY';
        switch (Gettext_gtk30.gettext(var_name)) {
            case 'calendar:MY':
                this._headerMonthFirst = true;
                break;
            case 'calendar:YM':
                this._headerMonthFirst = false;
                break;
            default:
                this._headerMonthFirst = true;
                break;
        }

        this._selectedDate = new DateUtils.JDate();

        this.actor = new St.Table({ homogeneous: false, style_class: 'calendar', reactive: true });
        this.actor.connect('scroll-event', (actor, event) => this._onScroll(actor, event));
        this.actor.connect('destroy', this.destroy.bind(this));

        this._buildHeader();
    }

    _events_updated() {
        this._queue_update();
    }

    _cancel_update() {
        this.signals.removeTimeout(this._update_id);
        this._update_id = 0;
    }

    destroy() {
        this.signals.destroy();
        this._cancel_update();
        if (this._set_date_idle_id > 0) {
            this.signals.removeTimeout(this._set_date_idle_id);
            this._set_date_idle_id = 0;
        }
    }

    _queue_update() {
        this._cancel_update();
        this._update_id = this.signals.addTimeout(Mainloop.idle_add, () => {
            this._update_id = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queue_set_date_idle(date) {
        this.setDate(date, false);
        this._set_date_idle_id = 0;
        return GLib.SOURCE_REMOVE;
    }

    queue_set_date(date) {
        if (this._set_date_idle_id > 0) return;
        this._set_date_idle_id = this.signals.addTimeout(Mainloop.timeout_add, 25, this._queue_set_date_idle.bind(this, date));
    }

    _update_events_enabled() {
        this.events_enabled = this.events_manager.is_active();
        this._queue_update();
    }

    _onSettingsChange(object, key) {
        this._buildHeader();
        this._update(false);
    }

    setDate(date, forceReload) {
        if (!_sameDay(date, this._selectedDate)) {
            this._selectedDate = date;
            this.emit('selected-date-changed', this._selectedDate);
            this._update(forceReload);
        } else if (forceReload) {
            this._update(forceReload);
        }
    }

    getSelectedDate() {
        return this._selectedDate;
    }

    todaySelected() {
        let today = new DateUtils.JDate();
        return this._selectedDate.getDate() === today.getDate() &&
               this._selectedDate.getMonth() === today.getMonth() &&
               this._selectedDate.getFullYear() === today.getFullYear();
    }

    _buildHeader() {
        let offsetCols = this.show_week_numbers ? 1 : 0;
        this.actor.destroy_all_children();
        this._dayCells = [];
        this._weekNumberCells = [];

        this._topBoxMonth = new St.BoxLayout();
        this._topBoxYear = new St.BoxLayout();

        if (this._headerMonthFirst) {
            this.actor.add(this._topBoxMonth, { row: 0, col: 0, col_span: offsetCols + 4 });
            this.actor.add(this._topBoxYear, { row: 0, col: offsetCols + 4, col_span: 3 });
        } else {
            this.actor.add(this._topBoxMonth, { row: 0, col: offsetCols + 3, col_span: 4 });
            this.actor.add(this._topBoxYear, { row: 0, col: 0, col_span: offsetCols + 3 });
        }

        this.actor.connect('style-changed', () => {
            this._digitWidth = _getDigitWidth(this.actor) / Pango.SCALE;
        });

        const addNavButton = (box, directionClass, callback) => {
            let btn = new St.Button({ style_class: `calendar-change-month-${directionClass}` });
            box.add(btn);
            btn.connect('clicked', callback);
        };

        addNavButton(this._topBoxMonth, 'back', () => this._applyDateBrowseAction(0, -1));
        
        this._monthLabel = new St.Label({ style_class: 'calendar-month-label' });
        this._topBoxMonth.add(this._monthLabel, { expand: true, x_fill: false, x_align: St.Align.MIDDLE });
        
        addNavButton(this._topBoxMonth, 'forward', () => this._applyDateBrowseAction(0, 1));

        addNavButton(this._topBoxYear, 'back', () => this._applyDateBrowseAction(-1, 0));
        
        this._yearLabel = new St.Label({ style_class: 'calendar-month-label' });
        this._topBoxYear.add(this._yearLabel, { expand: true, x_fill: false, x_align: St.Align.MIDDLE });
        
        addNavButton(this._topBoxYear, 'forward', () => this._applyDateBrowseAction(1, 0));

        let iter = new DateUtils.JDate(this._selectedDate);
        iter.setSeconds(0);
        iter.setHours(12);
        
        for (let i = 0; i < 7; i++) {
            let isFriday = iter.getDay() === 5;
            let styleClass = `calendar-day-base calendar-day-heading ${isFriday ? 'calendar-friday' : (DateUtils.isWorkDay(iter) ? 'calendar-work-day' : 'calendar-nonwork-day')}`;
            let customDayAbbrev = DateUtils.getCalendarDayAbbreviation(iter.getDay());
            let label = new St.Label({ style_class: styleClass, text: customDayAbbrev });
            
            this.actor.add(label, { 
                row: 1, 
                col: offsetCols + (7 + iter.getDay() - this._weekStart) % 7, 
                x_fill: false, x_align: St.Align.MIDDLE 
            });
            iter.setTime(iter.getTime() + MSECS_IN_DAY);
        }

        this._firstDayIndex = this.actor.get_n_children();
    }

    _onScroll(actor, event) {
        switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
            case Clutter.ScrollDirection.LEFT:
                this._applyDateBrowseAction(0, -1);
                break;
            case Clutter.ScrollDirection.DOWN:
            case Clutter.ScrollDirection.RIGHT:
                this._applyDateBrowseAction(0, 1);
                break;
        }
    }

    _getDaysInJalaliMonth(year, month) {
        if (month >= 0 && month <= 5) return 31;
        if (month >= 6 && month <= 10) return 30;
        
        // Month 11 (Esfand)
        let nextYearFarvardin1 = new DateUtils.JDate(year + 1, 0, 1);
        let lastDayOfEsfand = new DateUtils.JDate(nextYearFarvardin1.getTime() - MSECS_IN_DAY);
        return lastDayOfEsfand.getDate();
    }

    _applyDateBrowseAction(yearChange, monthChange) {
        let oldDate = this._selectedDate;
        let newMonth = oldDate.getMonth() + monthChange;
        let newYear = oldDate.getFullYear() + yearChange;

        if (newMonth > 11) {
            newYear++;
            newMonth = 0;
        } else if (newMonth < 0) {
            newYear--;
            newMonth = 11;
        }

        let newDayOfMonth = oldDate.getDate();
        let daysInMonth = this._getDaysInJalaliMonth(newYear, newMonth);
        if (newDayOfMonth > daysInMonth) {
            newDayOfMonth = daysInMonth;
        }

        let newDate = new DateUtils.JDate(newYear, newMonth, newDayOfMonth);
        this.queue_set_date(newDate);
    }

    _update(forceReload) {
        this._monthLabel.text = DateUtils.FARSI_MONTH_NAMES[this._selectedDate.getMonth()];
        this._yearLabel.text = DateUtils.farsiNumbers(this._selectedDate.getFullYear().toString());

        let beginDate = new DateUtils.JDate(this._selectedDate);
        beginDate.setDate(1);
        beginDate.setSeconds(0);
        beginDate.setHours(12);
        
        let daysToWeekStart = (7 + beginDate.getDay() - this._weekStart) % 7;
        beginDate.setTime(beginDate.getTime() - daysToWeekStart * MSECS_IN_DAY);

        let iter = new DateUtils.JDate(beginDate);
        let row = 2;
        let cellIndex = 0;
        let offsetCols = this.show_week_numbers ? 1 : 0;

        if (!this._dayCells) this._dayCells = [];
        if (!this._weekNumberCells) this._weekNumberCells = [];

        while (true) {
            let group, button, dot_box;
            
            if (cellIndex < this._dayCells.length) {
                let cellData = this._dayCells[cellIndex];
                group = cellData.group;
                button = cellData.button;
                dot_box = cellData.dot_box;
                group.show();
            } else {
                group = new Cinnamon.Stack();
                button = new St.Button();
                group.add_actor(button);

                dot_box = new Cinnamon.GenericContainer({ style_class: "calendar-day-event-dot-box" });
                dot_box.connect('allocate', this._allocate_dot_box.bind(this));
                group.add_actor(dot_box);
                
                this.actor.add(group, { row: row, col: offsetCols + (7 + iter.getDay() - this._weekStart) % 7 }); 
                this._dayCells.push({ group, button, dot_box });
            }

            button.label = DateUtils.farsiNumbers(iter.getDate().toString());
            
            let iterStr = iter.getTime();
            if (!this._dayCells[cellIndex].clickId) {
                this._dayCells[cellIndex].clickId = button.connect('clicked', () => {
                    if (!this.events_enabled) return;
                    let currentIterStr = this._dayCells[cellIndex].currentIterStr;
                    if (currentIterStr) this.setDate(new DateUtils.JDate(currentIterStr), false);
                });
            }
            this._dayCells[cellIndex].currentIterStr = iterStr;

            let isFriday = iter.getDay() === 5;
            let styleClass = `calendar-day-base calendar-day ${isFriday ? 'calendar-friday' : (DateUtils.isWorkDay(iter) ? 'calendar-work-day' : 'calendar-nonwork-day')}`;
            if (row === 2) styleClass = 'calendar-day-top ' + styleClass;
            if (iter.getDay() === this._weekStart) styleClass = 'calendar-day-left ' + styleClass;

            if (_today(iter)) styleClass += ' calendar-today';
            else if (iter.getMonth() !== this._selectedDate.getMonth()) styleClass += ' calendar-other-month-day';
            else styleClass += ' calendar-not-today';

            button.remove_style_pseudo_class('selected');
            if (_sameDay(this._selectedDate, iter)) {
                button.add_style_pseudo_class('selected');
            }
            button.style_class = styleClass;

            if (this.show_week_numbers && iter.getDay() === 4) {
                let weekRow = row - 2;
                let label;
                if (weekRow < this._weekNumberCells.length) {
                    label = this._weekNumberCells[weekRow];
                    label.show();
                } else {
                    label = new St.Label({ style_class: 'calendar-day-base calendar-week-number' });
                    this.actor.add(label, { row: row, col: 0, y_align: St.Align.MIDDLE });
                    this._weekNumberCells.push(label);
                }
                label.text = DateUtils.farsiNumbers(iter.getNativeDate().toLocaleFormat('%V'));
            }

            dot_box.destroy_all_children();
            let color_set = this.events_manager.get_colors_for_date(iter.getNativeDate());
            if (this.events_enabled && color_set !== null) {
                for (let color of color_set) {
                    dot_box.add_actor(new St.Bin({
                        style_class: "calendar-day-event-dot",
                        style: `background-color: ${color};`,
                        x_align: Clutter.ActorAlign.CENTER
                    }));
                }
            }

            cellIndex++;
            iter.setTime(iter.getTime() + MSECS_IN_DAY);
            if (iter.getDay() === this._weekStart) {
                row++;
                if (row > 7) break;
            }
        }

        for (let i = cellIndex; i < this._dayCells.length; i++) {
            this._dayCells[i].group.hide();
        }
        
        if (this.show_week_numbers) {
            let expectedWeekRows = row - 2;
            for (let i = expectedWeekRows; i < this._weekNumberCells.length; i++) {
                this._weekNumberCells[i].hide();
            }
        } else {
            for (let i = 0; i < this._weekNumberCells.length; i++) {
                this._weekNumberCells[i].hide();
            }
        }
    }

    _allocate_dot_box(actor, box, flags) {
        let children = actor.get_children();
        if (children.length === 0) return;

        let box_width = box.x2 - box.x1;
        let a_dot = children[0];
        let [mw, nw] = a_dot.get_preferred_width(-1);
        let [mh, nh] = a_dot.get_preferred_height(-1);

        if (nw <= 0) nw = 4;
        if (nh <= 0) nh = 4;

        let max_children_per_row = Math.max(1, Math.trunc(box_width / nw));
        let [found, max_rows] = actor.get_theme_node().lookup_double("max-rows", false);
        max_rows = found ? Math.trunc(max_rows) : 2;
        let n_rows = Math.min(max_rows, Math.ceil(children.length / max_children_per_row));

        let dots_left = children.length;
        let i = 0;
        
        for (let dot_row = 0; dot_row < n_rows; dot_row++, dots_left -= max_children_per_row) {
            let dots_this_row = Math.min(dots_left, max_children_per_row);
            let total_child_width = nw * dots_this_row;
            let start_x = Math.floor((box_width - total_child_width) / 2);

            let cbox = new Clutter.ActorBox();
            cbox.x1 = start_x;
            cbox.y1 = dot_row * nh;
            cbox.x2 = cbox.x1 + nw;
            cbox.y2 = cbox.y1 + nh;

            let allocated_this_row = 0;
            while (allocated_this_row < dots_this_row && i < children.length) {
                children[i].allocate(cbox, flags);
                cbox.x1 += nw;
                cbox.x2 += nw;
                i++;
                allocated_this_row++;
            }
        }
        
        let empty_box = new Clutter.ActorBox();
        empty_box.x1 = 0; empty_box.y1 = 0; empty_box.x2 = 0; empty_box.y2 = 0;
        while (i < children.length) {
            children[i].allocate(empty_box, flags);
            i++;
        }
    }
}

Signals.addSignalMethods(Calendar.prototype);
