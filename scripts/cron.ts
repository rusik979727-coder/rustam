/**
 * Өз серверіңізде автоматтандыруды іске қосу: `npm run cron`
 * (Next.js серверімен қатар жеке процесс ретінде жүреді.)
 */
import cron from "node-cron";
import { runFrequent, sendDailyReport } from "../lib/automations";

const tz = "Asia/Almaty";
cron.schedule("*/5 * * * *", async () => console.log(new Date().toISOString(), "frequent", await runFrequent()), { timezone: tz });
cron.schedule("0 20 * * *", async () => console.log(new Date().toISOString(), "daily report", await sendDailyReport()), { timezone: tz });
console.log("Белес CRM автоматтандыру іске қосылды (әр 5 мин + 20:00 есеп)");
runFrequent().then((r) => console.log("first run", r));
