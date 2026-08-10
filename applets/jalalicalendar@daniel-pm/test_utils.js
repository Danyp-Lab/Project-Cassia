const DateUtils = require('./modules/date-utils');
const now = new DateUtils.JDate();
console.log("Jalali Date:", DateUtils.toLocaleFormat(now, "%A %e %B %Y"));
console.log("Hijri Date:", DateUtils.getIslamicDateString(now));
