// テストごとに空のデータベースを使う（本物のデータには触らない）。ほかの import より先に読み込むこと
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.AI_LAB_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ai-lab-test-")), "test.db");
process.env.AI_LAB_SCHEDULER = "off";
