function countQuestionsByDay(records) {
  const stats = {};
  records.forEach((recordData) => {
    if (!recordData || !recordData.createdAt) return;
    // createdAt 是 UTC 时间，这里按本地时区取日期，避免凌晨时段被算到前一天
    const d = new Date(recordData.createdAt);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    stats[date] = (stats[date] || 0) + 1;
  });
  return stats;
}
