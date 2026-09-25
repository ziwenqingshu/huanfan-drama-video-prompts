// 逐项目新链路：安全枚举 → 直接成品下载 → 统一校验。无硬性总超时。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeJsonAtomic } = require('./project_layout');
const INVENTORY = path.join(__dirname, '盘点_2026-09-10', 'inventory_full.json');
const REPORT = path.join(__dirname, 'run_report.json');

function run(file, args) { return spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: 'inherit' }).status; }
let ids = process.argv.slice(2);
if (ids.length === 1 && ids[0] === '--all') ids = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')).list.map(x => String(x.id));
if (!ids.length) { console.error('用法: node run_all.js <workspaceId...> | --all'); process.exit(2); }
const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')).list;
const rows = [];
for (const id of ids) {
  const item = inventory.find(x => String(x.id) === String(id));
  if (!item) { rows.push({ id, status: 'fail', error: '不在盘点清单' }); continue; }
  console.log(`\n===== ${item.name}[${id}] =====`);
  const fetchCode = run('fetch_manifest_replay.js', [String(id)]);
  const collectCode = fetchCode === 0 ? run('collect_project.js', [String(id), '3']) : null;
  const stage = fetchCode !== 0 ? 'fetch' : collectCode !== 0 ? 'collect' : 'complete';
  const exit_code = fetchCode !== 0 ? fetchCode : collectCode;
  const row = { id: Number(id), name: item.name, fetched: fetchCode === 0, collected: collectCode === 0, stage, exit_code, finished_at: new Date().toISOString() };
  rows.push(row); writeJsonAtomic(REPORT, { updated_at: row.finished_at, rows });
  if (stage !== 'complete') console.error(`✗ ${item.name}[${id}]：${stage} 阶段退出码 ${exit_code}，保留断点账本供续跑`);
}
const failed = rows.filter(x => !x.collected).length;
console.log(`完成 ${rows.length - failed}/${rows.length}`);
process.exit(failed ? 1 : 0);
