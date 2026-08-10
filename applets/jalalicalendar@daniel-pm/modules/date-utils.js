/**
 * @file date-utils.js
 * @description Utility functions and classes for Jalali and Hijri date conversions.
 * Optimized for performance by caching Intl formatters.
 */

const FARSI_MONTH_NAMES = [
    "فروردین", "اردیبهشت", "خرداد",
    "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر",
    "دی", "بهمن", "اسفند"
];

const FARSI_MONTH_NAMES_SHORT = [
    "فرو", "ارد", "خرد",
    "تیر", "مرد", "شهر",
    "مهر", "آبا", "آذر",
    "دی", "بهم", "اسف"
];

const FARSI_DAY_NAMES = [
    "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"
];

const FARSI_DAY_NAMES_SHORT = [
    "ی", "د", "س", "چ", "پ", "ج", "ش"
];

const HIJRI_MONTH_NAMES = [
    "محرم", "صفر", "ربیع‌الاول", "ربیع‌الثانی",
    "جمادی‌الاول", "جمادی‌الثانی", "رجب", "شعبان",
    "رمضان", "شوال", "ذی‌القعده", "ذی‌الحجه"
];

const HIJRI_MONTH_OFFSETS = [185, 214, 244, 274, 303, 335, 9, 38, 67, 97, 127, 155];
const MSECS_IN_DAY = 24 * 60 * 60 * 1000;

// ============================================================================
// Cache Formatters for extreme performance boosts.
// Recreating Intl.DateTimeFormat is computationally expensive.
// ============================================================================
let _persianFormatter = null;
let _islamicFormatter = null;

function getPersianFormatter() {
    if (!_persianFormatter) {
        _persianFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" });
    }
    return _persianFormatter;
}

function getIslamicFormatter() {
    if (!_islamicFormatter) {
        _islamicFormatter = new Intl.DateTimeFormat("en-US-u-ca-islamic-tbla", { year: "numeric", month: "numeric", day: "numeric" });
    }
    return _islamicFormatter;
}

/**
 * Retrieves the index used for fetching predefined Hijri events.
 * @param {number} month - Hijri month (0-11)
 * @param {number} day - Hijri day (1-30)
 * @returns {number} Event array index
 */
function getHijriEventIndex(month, day) {
    return (HIJRI_MONTH_OFFSETS[month] + day - 1) % 365;
}

/**
 * Converts standard digits to Persian (Farsi) digits.
 * @param {string|number} strText - The text containing ASCII numbers.
 * @returns {string} Text with Farsi numbers.
 */
function farsiNumbers(strText) {
    if (strText == null) return '';
    return String(strText).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 1728));
}

/**
 * Extracts Persian date components from a standard JavaScript Date.
 * @param {Date} date - The date to convert.
 * @returns {{year: number, month: number, day: number, dayOfWeek: number}}
 */
function getPersianDateParts(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    const formatter = getPersianFormatter();
    const parts = formatter.formatToParts(d);
    const res = { dayOfWeek: d.getDay(), year: 1, month: 0, day: 1 };
    
    for (const p of parts) {
        if (p.type === "year") res.year = parseInt(p.value, 10);
        else if (p.type === "month") res.month = parseInt(p.value, 10) - 1;
        else if (p.type === "day") res.day = parseInt(p.value, 10);
    }
    return res;
}

/**
 * Extracts Islamic (Hijri) date components from a standard JavaScript Date.
 * @param {Date} date - The date to convert.
 * @returns {{year?: number, month?: number, day?: number, error?: boolean}}
 */
function getIslamicDateParts(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    try {
        const formatter = getIslamicFormatter();
        const parts = formatter.formatToParts(d);
        const res = {};
        for (const p of parts) {
            if (p.type === "year") res.year = parseInt(p.value, 10);
            else if (p.type === "month") res.month = parseInt(p.value, 10) - 1;
            else if (p.type === "day") res.day = parseInt(p.value, 10);
        }
        return res;
    } catch (e) {
        global.logWarning(`[Jalali Calendar] Error parsing Islamic date: ${e.message}`);
        return { error: true };
    }
}

/**
 * Converts a Persian date back to a standard Gregorian Date object.
 * @param {number} pyear - Persian year
 * @param {number} pmonth - Persian month (1-12)
 * @param {number} pday - Persian day (1-31)
 * @returns {Date} The equivalent Gregorian Date
 */
function persianToGregorianIntl(pyear, pmonth, pday) {
    // A heuristic estimate to start the search
    const candidate = new Date(pyear + 621, pmonth - 1, pday, 12, 0, 0);
    const offsets = [0, -1, 1, -2, 2, -3, 3];
    
    for (const offset of offsets) {
        const adj = new Date(candidate.getTime() + offset * 86400000);
        const adjParts = getPersianDateParts(adj);
        if (adjParts.year === pyear && (adjParts.month + 1) === pmonth && adjParts.day === pday) {
            return adj;
        }
    }
    return candidate;
}

const pad2 = number => number < 10 ? '0' + number : String(number);

/**
 * A wrapper class mimicking the standard Date API but operating in Jalali dates.
 */
class JDate {
    #d;

    /**
     * @param {number|JDate|Date} [a]
     * @param {number} [month]
     * @param {number} [day]
     * @param {number} [hour]
     * @param {number} [minute]
     * @param {number} [second]
     * @param {number} [millisecond]
     */
    constructor(a, month, day, hour, minute, second, millisecond) {
        if (arguments.length === 0) {
            this.#d = new Date();
        } else if (arguments.length === 1) {
            this.#d = new Date((a instanceof JDate) ? a.getNativeDate() : a);
        } else {
            const py = a;
            const pm = (month || 0) + 1;
            const pd = day || 1;
            const gDate = persianToGregorianIntl(py, pm, pd);
            this.#d = new Date(
                gDate.getFullYear(), gDate.getMonth(), gDate.getDate(), 
                hour || 0, minute || 0, second || 0, millisecond || 0
            );
        }
    }

    getNativeDate() { return this.#d; }

    #persianDate() {
        return getPersianDateParts(this.#d);
    }

    #setPersianDate(which, value) {
        const p = this.#persianDate();
        const py = (which === 0) ? value : p.year;
        const pm = (which === 1) ? value : (p.month + 1);
        const pd = (which === 2) ? value : p.day;
        const newGDate = persianToGregorianIntl(py, pm, pd);
        this.#d.setFullYear(newGDate.getFullYear());
        this.#d.setMonth(newGDate.getMonth());
        this.#d.setDate(newGDate.getDate());
    }

    getDate() { return this.#persianDate().day; }
    getMonth() { return this.#persianDate().month; }
    getFullYear() { return this.#persianDate().year; }
    
    setDate(v) { this.#setPersianDate(2, v); }
    setFullYear(v) { this.#setPersianDate(0, v); }
    setMonth(v) { this.#setPersianDate(1, v + 1); }

    toLocaleString() {
        return `${this.getFullYear()}/${pad2(this.getMonth() + 1)}/${pad2(this.getDate())} ` +
               `${pad2(this.getHours())}:${pad2(this.getMinutes())}:${pad2(this.getSeconds())}`;
    }

    valueOf() { return this.#d.valueOf(); }
    getTime() { return this.#d.getTime(); }
    setTime(v) { return this.#d.setTime(v); }
    getDay() { return this.#d.getDay(); }
    getHours() { return this.#d.getHours(); }
    getMinutes() { return this.#d.getMinutes(); }
    getSeconds() { return this.#d.getSeconds(); }
    getMilliseconds() { return this.#d.getMilliseconds(); }
    setHours(v) { return this.#d.setHours(v); }
    setSeconds(v) { return this.#d.setSeconds(v); }
}

/**
 * Checks if two dates land on the exact same Gregorian day.
 */
function sameDay(dateA, dateB) {
    return (dateA.getDate() === dateB.getDate() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getFullYear() === dateB.getFullYear());
}

/**
 * Work days in Iran typically exclude Fridays (5).
 */
function isWorkDay(date) {
    return date.getDay() !== 5;
}

function getCalendarDayAbbreviation(dayNumber) {
    return FARSI_DAY_NAMES_SHORT[dayNumber];
}

/**
 * Replaces typical format tokens (e.g., %Y, %m, %d) with Farsi equivalents for the given JDate.
 */
function toLocaleFormat(jdate, strFormat) {
    if (!jdate || !strFormat) return '';
    let dateResult = strFormat;
    
    dateResult = dateResult.replace(/%Y/g, jdate.getFullYear().toString());
    dateResult = dateResult.replace(/%y/g, jdate.getFullYear().toString().slice(-2));
    dateResult = dateResult.replace(/%d/g, jdate.getDate().toString());
    dateResult = dateResult.replace(/%e/g, farsiNumbers(jdate.getDate().toString()));
    dateResult = dateResult.replace(/%m/g, (jdate.getMonth() + 1).toString());
    dateResult = dateResult.replace(/%B/g, FARSI_MONTH_NAMES[jdate.getMonth()]);
    dateResult = dateResult.replace(/%b/g, FARSI_MONTH_NAMES_SHORT[jdate.getMonth()]);
    dateResult = dateResult.replace(/%A/g, FARSI_DAY_NAMES[jdate.getDay()]);
    dateResult = dateResult.replace(/%a/g, FARSI_DAY_NAMES_SHORT[jdate.getDay()]);

    const nativeDate = jdate.getNativeDate ? jdate.getNativeDate() : jdate;
    if (typeof nativeDate.toLocaleFormat === 'function') {
        dateResult = nativeDate.toLocaleFormat(dateResult);
    }
    return dateResult;
}

/**
 * Produces a formatted string representing the Islamic date, completely localized.
 */
function getIslamicDateString(jdate) {
    const d = (jdate instanceof JDate) ? jdate.getNativeDate() : jdate;
    const parts = getIslamicDateParts(d);
    if (parts.error) return "";
    const monthName = HIJRI_MONTH_NAMES[parts.month] || '';
    return farsiNumbers(`${parts.day} ${monthName} ${parts.year}`);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        JDate,
        farsiNumbers,
        toLocaleFormat,
        getIslamicDateString,
        getPersianDateParts,
        getIslamicDateParts,
        getHijriEventIndex,
        FARSI_MONTH_NAMES,
        FARSI_DAY_NAMES,
        FARSI_DAY_NAMES_SHORT,
        sameDay,
        isWorkDay,
        getCalendarDayAbbreviation,
        MSECS_IN_DAY
    };
}
