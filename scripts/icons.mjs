import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const canvas = createCanvas(size, size),
    ctx = canvas.getContext("2d");
  ctx.scale(size / 128, size / 128);
  ctx.fillStyle = "#1b5342";
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 128, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "italic bold 94px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("J", 58, 98);
  ctx.strokeStyle = "#cff39b";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(86, 41);
  ctx.lineTo(105, 22);
  ctx.moveTo(87, 22);
  ctx.lineTo(105, 22);
  ctx.lineTo(105, 40);
  ctx.stroke();
  await writeFile(
    `public/icons/icon-${size}.png`,
    canvas.toBuffer("image/png"),
  );
}
console.log("工具栏与主页面共用的 J↗ 图标已生成");
