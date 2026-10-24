# Lightly — File Compressor

บีบอัด JPG / PNG / WebP ใน browser และ PDF ผ่าน Python worker ที่เซิร์ฟเวอร์ ครั้งละหนึ่งไฟล์ พร้อม drag & drop, presets, quality และ download ภาพไม่ถูกส่งขึ้น server; PDF ใช้ไฟล์ชั่วคราวที่เซิร์ฟเวอร์และลบทันทีเมื่อเสร็จ ล้มเหลว หรือยกเลิก

## รันในเครื่อง

ใช้ Node.js 18 ขึ้นไป และ Python 3.9 ขึ้นไปบน macOS / Linux ติดตั้ง Python dependency ครั้งแรก:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm start
```

เปิด http://localhost:3000 หรือกำหนดพอร์ตด้วย `PORT=3001 npm start`

เปิดผ่าน Node server สำหรับฟังก์ชันครบทั้งหมด; การเปิด static files ผ่าน MAMP โดยตรงรองรับเฉพาะภาพ ไม่มี PDF API

## Deploy จาก GitHub

### GitHub Pages สำหรับหน้าเว็บ

1. Push ไฟล์โปรเจกต์นี้ขึ้น repository แล้วเลือก **Settings → Pages → Source → GitHub Actions**
2. Workflow `.github/workflows/static.yml` จะตรวจ JavaScript, ทดสอบ packaging และสร้าง `_site` ให้อัตโนมัติ โดยเผยแพร่เฉพาะ HTML/CSS/JS ไม่รวม Python, server, environment หรือเอกสารผู้ใช้
3. เปิด URL ที่หน้า **Actions → Deploy static content to Pages** หรือ **Settings → Pages** แสดงเมื่อ deploy สำเร็จ เช่น `https://ktppuz.github.io/srs-dev/`
4. ถ้ายังไม่มี backend หน้าเว็บจะเปิดใช้เฉพาะบีบอัดภาพ ส่วน PDF จะแจ้งว่ายังไม่พร้อม ไม่ส่งคำขอไป API ที่ไม่มีอยู่บน Pages

### Backend สำหรับบีบอัดและรวม PDF

นำ repository เดียวกันไป deploy บนโฮสต์ที่รองรับ Docker โดยใช้ `Dockerfile` ที่เพิ่มให้ ตั้งค่าตัวแปรในระบบของโฮสต์ตามนี้:

| ตัวแปร | ตัวอย่าง | ความหมาย |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `https://api.example.com` | URL จริงของ backend หรือ URL ของเว็บถ้าโฮสต์ทั้งเว็บและ API ด้วยกัน |
| `ALLOWED_ORIGINS` | `https://ktppuz.github.io` | เว็บที่อนุญาตให้เรียก API คั่นหลาย origin ด้วย comma; ไม่ใส่ `/srs-dev/` |
| `PORT` | `3000` | พอร์ตภายใน ใช้ค่าที่โฮสต์กำหนดได้ |
| `HOST` | `0.0.0.0` | Docker กำหนดค่าเริ่มต้นนี้ให้แล้ว |

เมื่อมี URL จริงแล้ว ไปที่ GitHub **Settings → Secrets and variables → Actions → Variables → New repository variable** เพิ่ม **`API_BASE_URL`** เป็น URL backend เช่น `https://api.example.com` แล้วรัน workflow Pages ใหม่ ค่านี้เป็น URL สาธารณะ ไม่ใช่ secret และต้องใช้ HTTPS โดยไม่มี path/query

`API_BASE_URL` เป็นค่าตอน build หน้าเว็บ ส่วน `PUBLIC_ORIGIN` / `ALLOWED_ORIGINS` เป็น environment ตอนรัน backend ใช้ชื่อโดเมนจริงของคุณแทนตัวอย่างทั้งหมด; ไฟล์ `.env.example` เป็นเพียงตัวอย่างและ `npm start` ไม่โหลด `.env` อัตโนมัติ

ถ้าโฮสต์เว็บกับ API ใน Docker เดียวกัน ไม่จำเป็นต้องใช้ Pages หรือกำหนด `API_BASE_URL` หน้าเว็บจะเรียก API บนโดเมนเดียวกันโดยอัตโนมัติ

### ทดสอบ Docker ในเครื่อง

```sh
docker build -t lightly .
docker run --rm --init -p 127.0.0.1:3002:3000 --memory=1g --cpus=2 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=384m -e PUBLIC_ORIGIN=http://localhost:3002 lightly
```

เปิด `http://localhost:3002` สำหรับทดสอบ production ใช้ HTTPS ที่ reverse proxy / โฮสต์ และส่ง `Host` เดิมให้แอป ตรวจสุขภาพได้ที่ `GET /healthz` ตั้ง request timeout มากกว่า 90 วินาทีและขนาด request อย่างน้อย 101 MiB หากต้องการรองรับ merge เต็ม limit

Container รันด้วย user ที่ไม่ใช่ root ใช้หนึ่ง worker ต่อครั้ง หากมีงานอยู่แล้วคืน 429 ให้ลองใหม่ CORS ตรวจ origin ที่ระบุและ expose headers ที่ frontend ใช้คำนวณผลลัพธ์ CORS ไม่ใช่ระบบยืนยันตัวตน; สำหรับเว็บสาธารณะที่มีการใช้งานมากควรกำหนด rate limit ที่ reverse proxy และขนาด resource ที่โฮสต์ด้วย

## PDF

- เลือก PDF สูงสุด 50 MiB / 500 หน้า แล้วปรับ quality หรือ preset ก่อนบีบอัด ผลลัพธ์เป็น PDF เปิดดูเอกสารก่อน–หลังได้จากลิงก์ในผลลัพธ์
- ใช้ PyMuPDF ลดคุณภาพและ downsample ภาพภายในเอกสาร โดยไม่แปลงทั้งหน้าเป็นภาพ จึงคงข้อความค้นหาได้และเวกเตอร์ไว้ ระดับคุณภาพสูง / สมดุล / ไฟล์เล็กใช้ 200 / 150 / 96 DPI ตามลำดับ
- ไม่รองรับ PDF เข้ารหัสหรือมีช่องลายเซ็นดิจิทัล เพราะการเขียนเอกสารใหม่กระทบลายเซ็น ภาพภายในแต่ละภาพจำกัด 40 ล้านพิกเซล
- PDF ที่มีแต่ข้อความหรือบีบอัดมาแล้วอาจเล็กลงน้อยหรือไม่ลดเลย ถ้า output ไม่เล็กลงจะดาวน์โหลดต้นฉบับแทน
- `POST /api/pdf?quality=75` รับ raw `application/pdf` พร้อม `X-File-Compressor: 1` ส่ง PDF กลับ มี headers `X-PDF-Pages`, `X-PDF-DPI`, `X-PDF-Original` ไม่ส่งชื่อไฟล์ผู้ใช้ไปยัง server
- worker ทำงานแยก process ครั้งละหนึ่งงาน จำกัดเวลา 90 วินาที ยกเลิก request แล้วหยุด process และล้าง temp directory ก่อนตอบกลับ หากมีงานอยู่แล้วคืน 429 เพื่อให้ลองใหม่
- รันได้ทั้ง localhost และ Docker บนโฮสต์ที่กำหนด ไม่มี persistent queue, accounts, OS sandbox หรือ scheduled cleanup สำหรับกรณี server ถูก force kill; macOS จำกัด CPU/เวลา/ขนาด output แต่ไม่มี hard memory cap ของ worker
- dependency: [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/document.html#Document.rewrite_images) (AGPL / commercial license)

## ขอบเขตและข้อจำกัด

### รวม PDF

- เลือกแท็บ **รวม PDF** เพิ่มเอกสารหลายไฟล์ในครั้งเดียวหรือเพิ่มทีหลัง ใช้ ↑ / ↓ จัดลำดับ และ × นำไฟล์ออก แล้วกดรวม PDF
- รวม 2–20 ไฟล์ ไฟล์ละไม่เกิน 50 MiB รวมไม่เกิน 100 MiB และผลลัพธ์ไม่เกิน 500 หน้า
- รวมหน้าโดยไม่ลดคุณภาพภาพ เก็บข้อความ เวกเตอร์ ลิงก์ทั่วไป annotations และ form fields พร้อมย้าย bookmarks ตามเลขหน้าใหม่ ไฟล์ชื่อซ้ำหรือไฟล์เดิมที่เลือกซ้ำยังคงแยกตามลำดับ
- ไม่รองรับ PDF เข้ารหัส/มีช่องลายเซ็นดิจิทัล และไม่คัดลอกไฟล์แนบหรือ metadata ระดับเอกสาร; named links บางประเภทอาจไม่ถูกคัดลอก
- ผลลัพธ์ดาวน์โหลดเป็น `merged.pdf` มีลิงก์เปิดดูก่อนดาวน์โหลด เปลี่ยนลำดับหรือรายการไฟล์แล้วผลลัพธ์เก่าจะถูกล้างเพื่อป้องกันดาวน์โหลดผิดชุด
- `POST /api/pdf/merge` รับ `multipart/form-data` โดยใช้ field `files` ซ้ำตามลำดับ พร้อม header `X-File-Compressor: 1` ผลลัพธ์เป็น PDF พร้อม `X-PDF-Pages` และ `X-PDF-Files`
- ใช้ worker และข้อจำกัดเวลาเดียวกับการบีบอัด PDF ยกเลิกและลองใหม่ได้ ไฟล์ชั่วคราวถูกล้างก่อนส่งผลลัพธ์กลับ

- ตรวจนามสกุล, MIME, magic bytes และขนาดภาพก่อน decode; limits อยู่ใน `CONFIG` ที่ต้น `app.js`: 20 MiB, 40 ล้านพิกเซล, ด้านละไม่เกิน 16,384 px
- ใช้ browser canvas จึงรองรับเฉพาะรูปแบบที่ browser encode ได้ PNG ไม่ใช้ quality slider; เลือก WebP หรือ resize เพื่อลดขนาด
- รักษา alpha สำหรับ PNG/WebP; JPG เติมพื้นสีขาว, metadata ถูกลบ และ color profile อาจเปลี่ยน; orientation ใช้ browser image decoder
- ถ้าผลลัพธ์ไม่เล็กลง เสนอไฟล์ต้นฉบับและแสดงการประหยัด 0% โดยแจ้งชัดเจน
- Progress เป็นขั้นตอนการทำงาน ไม่ใช่เปอร์เซ็นต์ byte ที่ encode จริง Cancel ยกเลิกผลลัพธ์ แต่ browser อาจยังประมวลผล canvas ที่เริ่มไปแล้วจนเสร็จ
- ยังไม่มี video, batch, ZIP, accounts, persistent backend queue หรือ server storage; WebP เคลื่อนไหวไม่รองรับ
- ใช้ browser รุ่นปัจจุบันที่รองรับ `createImageBitmap` และ canvas; ต้องทดสอบ Safari / Firefox และมือถือเพิ่มเติมก่อนใช้งานจริง

## ตรวจสอบ

```sh
npm run check
npm run test:pages
.venv/bin/python tests/test_pdf.py
```

PDF integration tests สร้างไฟล์ทดสอบเองและเริ่ม server บนพอร์ตว่าง ตรวจการบีบอัดจริง ข้อความ/จำนวนหน้า presets ขนาดไฟล์ password ไฟล์เสีย origin concurrency cancel/retry การล้างไฟล์ชั่วคราว และการรวม PDF ตามลำดับ รวมถึง bookmarks, ไฟล์ซ้ำ และข้อจำกัดจำนวนไฟล์/หน้า

ตรวจรับใน browser: เลือกภาพ JPG/PNG/WebP/PDF, ปรับค่า, บีบอัดและเปิดไฟล์ดาวน์โหลด; ลองไฟล์ผิดชนิด/ไฟล์ใหญ่, ยกเลิกและ retry, ภาพโปร่งใส, ผลลัพธ์ไม่เล็กลง และใช้งานด้วยคีย์บอร์ด
# srs-dev
