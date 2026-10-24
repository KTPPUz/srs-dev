"""One process per local PDF request; keep text and vectors as document objects."""
import json
import resource
import sys
import pymupdf

resource.setrlimit(resource.RLIMIT_CPU, (80, 85))
resource.setrlimit(resource.RLIMIT_FSIZE, (150 * 1024 * 1024, 150 * 1024 * 1024))
if sys.platform != "darwin":
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))


def compress(source, target, quality):
    with pymupdf.open(source) as doc:
        if not doc.is_pdf:
            raise ValueError("ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง")
        if doc.needs_pass or doc.is_encrypted:
            raise ValueError("ยังไม่รองรับ PDF ที่เข้ารหัสหรือมีรหัสผ่าน")
        if not 1 <= doc.page_count <= 500:
            raise ValueError("รองรับ PDF ตั้งแต่ 1 ถึง 500 หน้า")
        if doc.get_sigflags() > 0:
            raise ValueError("PDF นี้มีช่องลายเซ็นดิจิทัล กรุณาใช้ไฟล์ที่ไม่มีลายเซ็นเพื่อคงความถูกต้องของเอกสาร")
        for page in doc:
            for image in page.get_images():
                if image[2] * image[3] > 40_000_000:
                    raise ValueError("PDF มีภาพภายในเกิน 40 ล้านพิกเซล กรุณาลดขนาดภาพก่อน")
        dpi = 200 if quality >= 85 else 150 if quality >= 60 else 96
        doc.rewrite_images(dpi_threshold=dpi + 25, dpi_target=dpi, quality=quality)
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.save(target, garbage=4, deflate=True, deflate_images=True,
                 deflate_fonts=True, use_objstms=1)
        with pymupdf.open(target) as output:
            if output.page_count != doc.page_count:
                raise ValueError("ตรวจสอบผลลัพธ์ PDF ไม่ผ่าน กรุณาลองอีกครั้ง")
        return {"pages": doc.page_count, "dpi": dpi}


def merge(manifest, target):
    with open(manifest) as handle:
        paths = json.load(handle)
    if not 2 <= len(paths) <= 20:
        raise ValueError("กรุณาเลือก PDF ตั้งแต่ 2 ถึง 20 ไฟล์")
    with pymupdf.open() as output:
        toc = []
        for index, path in enumerate(paths):
            try:
                with pymupdf.open(path) as source:
                    if not source.is_pdf or source.needs_pass or source.is_encrypted:
                        raise ValueError("ต้องเป็น PDF ที่ไม่มีการเข้ารหัสหรือรหัสผ่าน")
                    if source.get_sigflags() > 0:
                        raise ValueError("ไม่รองรับ PDF ที่มีช่องลายเซ็นดิจิทัล")
                    if not source.page_count or output.page_count + source.page_count > 500:
                        raise ValueError("จำนวนหน้ารวมต้องอยู่ระหว่าง 1 ถึง 500 หน้า")
                    offset = output.page_count
                    output.insert_pdf(source, links=True, annots=True, widgets=True)
                    # Offset source bookmarks into the merged page numbering.
                    for level, title, page in source.get_toc():
                        toc.append([level, title, page + offset if page > 0 else -1])
            except Exception as error:
                detail = str(error) if isinstance(error, ValueError) else "ไฟล์เสียหรือไม่สามารถอ่านได้"
                raise ValueError(f"ไฟล์ลำดับ {index + 1}: {detail}") from error
        if toc:
            output.set_toc(toc)
        pages = output.page_count
        output.save(target, garbage=4, deflate=True, use_objstms=1)
    with pymupdf.open(target) as check:
        if check.page_count != pages:
            raise ValueError("ตรวจสอบจำนวนหน้าของผลลัพธ์ไม่ผ่าน")
    return {"pages": pages, "files": len(paths)}


try:
    result = merge(sys.argv[1], sys.argv[2]) if sys.argv[3] == "merge" else compress(sys.argv[1], sys.argv[2], int(sys.argv[3]))
    print(json.dumps(result))
except ValueError as error:
    print(json.dumps({"error": str(error)}))
    sys.exit(2)
except Exception:
    print(json.dumps({"error": "ไม่สามารถอ่านหรือบีบอัด PDF ได้ ไฟล์อาจเสียหรือใช้ทรัพยากรเกินกำหนด"}))
    sys.exit(2)
