// Fills the fake sheets with the same layout as the real «BELES · Касса» spreadsheet.
(function (g) {
  const D = (iso) => g.Utilities.parseDate(iso, "Asia/Almaty", "yyyy-MM-dd");
  const T = (t) => { const [h, m] = t.split(":").map(Number); return (h * 60 + m) / 1440; };
  g.__seed = function (data) {
    const P = g.__addSheet("Пациенттер", 1000, 16), Y = g.__addSheet("Төлемдер", 5000, 9), X = g.__addSheet("Расход", 2000, 5);
    P.data[0] = ["Пациенттің аты-жөні", "Ем басталған күні", "Ем аяқталған күні", "", "", "Емнің жалпы құны, ₸", "", "", "", "", "", "", "Ескертпе", "", "", ""];
    Y.data[0] = ["Күні", "Уақыты", "Пациент", "Түрі", "Төлем тәсілі", "Сома, ₸", "Ескертпе", "", ""];
    X.data[0] = ["Күні", "Санат", "Сома, ₸", "Төлем тәсілі", "Ескертпе"];
    (data.patients || []).forEach((p, i) => { const r = P.data[i + 1]; r[0] = p.name; r[1] = p.start ? D(p.start) : ""; r[2] = p.end ? D(p.end) : ""; r[5] = p.cost || ""; });
    (data.payments || []).forEach((x, i) => { Y.data[i + 1].splice(0, 7, D(x[0]), T(x[1]), x[2], x[3], x[4], x[5], x[6] || ""); });
    (data.expenses || []).forEach((x, i) => { X.data[i + 1] = [D(x[0]), x[1], x[2], x[3], x[4] || ""]; });
  };
})(typeof window !== "undefined" ? window : globalThis);
