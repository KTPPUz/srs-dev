"""Integration checks using real PDFs and the local Node/Python worker."""
import http.client
import json
import os
from pathlib import Path
import random
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import pymupdf

ROOT = Path(__file__).resolve().parents[1]


class PDFTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.base = f'http://localhost:{cls.port}'
        cls.temp = tempfile.TemporaryDirectory(prefix='lightly-test-')
        cls.server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT,
            env={**os.environ, 'PORT': str(cls.port), 'TMPDIR': cls.temp.name, **getattr(cls, 'server_env', {})},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.base, timeout=1).close()
                break
            except OSError:
                time.sleep(.05)
        else:
            cls.server.terminate()
            raise RuntimeError('Server did not start')
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text((40, 40), 'Searchable text stays searchable')
        samples = random.Random(42).randbytes(1200 * 900 * 3)
        pix = pymupdf.Pixmap(pymupdf.csRGB, 1200, 900, samples, False)
        page.insert_image(pymupdf.Rect(30, 80, 300, 282.5), pixmap=pix)
        cls.pdf = doc.tobytes()
        Path('/tmp/lightly-sample.pdf').write_bytes(cls.pdf)
        doc.close()

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)
        cls.temp.cleanup()

    def request(self, data, quality=75, headers=None):
        req = urllib.request.Request(f'{self.base}/api/pdf?quality={quality}', data=data,
            headers=headers or {'Content-Type': 'application/pdf', 'X-File-Compressor': '1'})
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_compress_preserves_pages_and_searchable_text(self):
        code, headers, body = self.request(self.pdf)
        self.assertEqual(code, 200)
        self.assertLess(len(body), len(self.pdf))
        self.assertEqual(headers['Content-Type'], 'application/pdf')
        self.assertEqual(headers['X-PDF-Pages'], '1')
        with pymupdf.open(stream=body, filetype='pdf') as result:
            self.assertEqual(result.page_count, 1)
            self.assertIn('Searchable text stays searchable', result[0].get_text())
            self.assertGreater(result[0].get_pixmap().width, 0)
        time.sleep(.05)
        self.assertEqual(list(Path(self.temp.name).glob('lightly-pdf-*')), [])

    def test_presets_produce_different_image_sizes(self):
        _, hi, high = self.request(self.pdf, 90)
        _, lo, low = self.request(self.pdf, 45)
        self.assertEqual(hi['X-PDF-DPI'], '200')
        self.assertEqual(lo['X-PDF-DPI'], '96')
        self.assertLess(len(low), len(high))

    def test_no_savings_returns_original(self):
        _, _, first = self.request(self.pdf, 45)
        _, headers, second = self.request(first, 45)
        self.assertLessEqual(len(second), len(first))
        if headers['X-PDF-Original'] == '1':
            self.assertEqual(second, first)

    def test_encrypted_rejected(self):
        with pymupdf.open(stream=self.pdf, filetype='pdf') as doc:
            encrypted = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                owner_pw='owner', user_pw='secret')
        code, _, body = self.request(encrypted)
        self.assertEqual(code, 422)
        self.assertIn('รหัสผ่าน', json.loads(body)['error'])

    def test_bad_signature_and_corrupt_pdf(self):
        self.assertEqual(self.request(b'not a PDF')[0], 400)
        self.assertEqual(self.request(b'%PDF-1.7\nnot valid')[0], 422)

    def test_limits_and_origin(self):
        self.assertEqual(self.request(b'%PDF-1.7\n', 200)[0], 400)
        self.assertEqual(self.request(b'%PDF-1.7\n', headers={'Content-Type': 'application/pdf',
            'X-File-Compressor': '1', 'Origin': 'https://example.com'})[0], 403)
        conn = http.client.HTTPConnection('localhost', self.port, timeout=5)
        conn.request('POST', '/api/pdf?quality=75', headers={'Content-Type': 'application/pdf',
            'X-File-Compressor': '1', 'Content-Length': str(51 * 1024 * 1024)})
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()

    def test_concurrency_cancel_and_retry(self):
        conn = http.client.HTTPConnection('localhost', self.port, timeout=5)
        conn.putrequest('POST', '/api/pdf?quality=75')
        for key, value in {'Content-Type': 'application/pdf', 'X-File-Compressor': '1', 'Content-Length': '10000'}.items():
            conn.putheader(key, value)
        conn.endheaders()
        conn.send(b'%PDF-1.7\n')
        time.sleep(.1)
        self.assertEqual(self.request(b'%PDF-1.7\n')[0], 429)
        conn.close()
        time.sleep(.2)
        self.assertEqual(self.request(self.pdf)[0], 200)

    def merge_request(self, inputs):
        boundary = 'LightlyTestBoundary42'
        chunks = []
        for content in inputs:
            chunks.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="same.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode(), content, b'\r\n'])
        chunks.append(f'--{boundary}--\r\n'.encode())
        req = urllib.request.Request(f'{self.base}/api/pdf/merge', data=b''.join(chunks),
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'X-File-Compressor': '1'})
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    @staticmethod
    def text_pdf(labels):
        with pymupdf.open() as doc:
            for label in labels:
                page = doc.new_page(width=420, height=595)
                page.insert_text((40, 40), label)
            doc.set_toc([[1, labels[0], 1]])
            return doc.tobytes()

    def test_merge_page_order_text_and_bookmarks(self):
        first = self.text_pdf(['B first', 'B second'])
        second = self.text_pdf(['A last'])
        code, headers, body = self.merge_request([first, second])
        self.assertEqual(code, 200)
        self.assertEqual(headers['X-PDF-Pages'], '3')
        self.assertEqual(headers['X-PDF-Files'], '2')
        with pymupdf.open(stream=body, filetype='pdf') as result:
            self.assertEqual([page.get_text().strip() for page in result], ['B first', 'B second', 'A last'])
            self.assertEqual([entry[2] for entry in result.get_toc()], [1, 3])
            self.assertEqual(result[0].rect.width, 420)
            self.assertGreater(result[2].get_pixmap().width, 0)
        self.assertEqual(list(Path(self.temp.name).glob('lightly-pdf-*')), [])

    def test_merge_repeated_file_is_not_dropped(self):
        item = self.text_pdf(['Repeated page'])
        code, _, body = self.merge_request([item, item])
        self.assertEqual(code, 200)
        with pymupdf.open(stream=body, filetype='pdf') as result:
            self.assertEqual(result.page_count, 2)

    def test_merge_limits(self):
        item = self.text_pdf(['page'])
        self.assertEqual(self.merge_request([item])[0], 422)
        self.assertEqual(self.merge_request([item] * 21)[0], 422)
        many = self.text_pdf(['page'] * 500)
        self.assertEqual(self.merge_request([many, item])[0], 422)

    def test_merge_rejects_bad_and_encrypted_without_partial_result(self):
        item = self.text_pdf(['page'])
        self.assertEqual(self.merge_request([item, b'not PDF'])[0], 422)
        self.assertEqual(self.merge_request([item, b'%PDF-1.7\nbroken'])[0], 422)
        with pymupdf.open(stream=item, filetype='pdf') as doc:
            encrypted = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='secret')
        code, _, body = self.merge_request([item, encrypted])
        self.assertEqual(code, 422)
        self.assertIn('ลำดับ 2', json.loads(body)['error'])
        self.assertEqual(list(Path(self.temp.name).glob('lightly-pdf-*')), [])
        self.assertEqual(self.merge_request([item, item])[0], 200)


class HostingTests(unittest.TestCase):
    server_env = {'NODE_ENV': 'production', 'PUBLIC_ORIGIN': 'https://api.example.com',
                  'ALLOWED_ORIGINS': 'https://ktppuz.github.io'}
    setUpClass = classmethod(PDFTests.setUpClass.__func__)
    tearDownClass = classmethod(PDFTests.tearDownClass.__func__)
    request = PDFTests.request

    def test_pages_preflight_and_unknown_origin(self):
        for origin, expected in [('https://ktppuz.github.io', 204), ('https://evil.example', 403)]:
            req = urllib.request.Request(self.base + '/api/pdf', method='OPTIONS', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type,x-file-compressor'})
            try:
                response = urllib.request.urlopen(req)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                self.assertEqual(response.status, expected)
                if expected == 204:
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'], origin)
                    self.assertEqual(response.headers['Access-Control-Allow-Methods'], 'POST')
                else:
                    self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))

    def test_pages_pdf_response_exposes_metadata(self):
        code, headers, body = self.request(self.pdf, headers={
            'Content-Type': 'application/pdf', 'X-File-Compressor': '1',
            'Origin': 'https://ktppuz.github.io', 'Host': 'api.example.com'})
        self.assertEqual(code, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://ktppuz.github.io')
        self.assertIn('X-PDF-Pages', headers['Access-Control-Expose-Headers'])
        self.assertTrue(body.startswith(b'%PDF-'))

    def test_same_origin_https_api_and_health(self):
        self.assertEqual(self.request(b'not pdf', headers={'Content-Type': 'application/pdf',
            'X-File-Compressor': '1', 'Origin': 'https://api.example.com'})[0], 400)
        with urllib.request.urlopen(self.base + '/healthz') as response:
            self.assertEqual(json.loads(response.read()), {'status': 'ok'})
        for file in ['config.js', 'api.js']:
            with urllib.request.urlopen(self.base + '/' + file) as response:
                self.assertEqual(response.status, 200)
        self.assertEqual(self.request(b'', headers={'Host': 'evil.example',
            'Content-Type': 'application/pdf', 'X-File-Compressor': '1'})[0], 403)


if __name__ == '__main__':
    unittest.main(verbosity=2)
