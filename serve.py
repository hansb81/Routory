"""TripLog 개발용 정적 서버.

python -m http.server는 JS/CSS가 브라우저에 캐시돼 수정한 내용이 안 보이는 일이 잦아서,
모든 응답에 Cache-Control: no-store를 붙여 항상 최신 파일을 내려준다.

사용법:
  python serve.py [포트]            같은 Wi-Fi/네트워크의 휴대폰에서도 접속할 수 있다 (기본 포트 8080)
  python serve.py [포트] --local    이 PC(localhost)에서만 접속할 수 있다

서빙하는 곳은 triplog/ 폴더뿐이다. 여행 데이터는 각 기기 브라우저의 저장소에 있어서 서버에는 없다.
"""

import http.server
import ipaddress
import os
import socket
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "triplog")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        self._rewrite_clean_url()
        super().do_GET()

    def do_HEAD(self):
        self._rewrite_clean_url()
        super().do_HEAD()

    def _rewrite_clean_url(self):
        # 네이버 로그인 콜백(/auth/naver-callback)처럼 해시 라우터 밖에서 확장자 없이 열리는 순수 경로를 위한
        # 최소한의 처리: 그 경로 그대로의 파일이 없고 같은 이름의 .html 파일이 있으면 그걸 대신 내려준다
        # (배포 환경에서는 triplog/vercel.json의 rewrites가 같은 역할을 한다).
        path, sep, query = self.path.partition("?")
        if path.endswith("/") or "." in os.path.basename(path):
            return
        if os.path.exists(self.translate_path(self.path)):
            return
        if os.path.isfile(self.translate_path(path) + ".html"):
            self.path = f"{path}.html{sep}{query}"


def local_addresses():
    """이 PC의 IPv4 주소들(loopback 제외). 휴대폰에서 접속할 때 쓸 주소 후보다."""
    found = []

    def add(ip):
        if ip and ip not in found and not ip.startswith(("127.", "169.254.")):
            found.append(ip)

    try:  # 실제로 패킷을 보내지 않고, 밖으로 나갈 때 쓰는 주소를 알아낸다
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass
    return found


def print_banner(port, local_only):
    print(f"TripLog 서버가 켜졌어요.\n  이 PC   : http://localhost:{port}/")
    if local_only:
        print("  (--local: 이 PC에서만 접속할 수 있어요)")
        return

    addresses = local_addresses()
    print("  휴대폰  : 휴대폰을 PC와 같은 Wi-Fi/네트워크에 연결하고, 아래 주소 중 하나를 브라우저에 입력하세요.")
    for ip in addresses:
        print(f"            http://{ip}:{port}/")
    if any(ipaddress.ip_address(ip).is_global for ip in addresses):
        print(
            "  주의    : 공인 IP 주소가 있어서 같은 네트워크 밖에서도 접속될 수 있어요.\n"
            "            (앱 파일만 공개되고 여행 데이터는 서버에 없어요.) 다 쓰면 서버를 끄거나 --local로 실행하세요."
        )


if __name__ == "__main__":
    # 콘솔 인코딩이 한글이나 기호를 못 찍어도 서버가 죽지 않게 한다
    sys.stdout.reconfigure(errors="replace")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8080
    local_only = "--local" in sys.argv

    print_banner(port, local_only)
    sys.stdout.flush()
    host = "127.0.0.1" if local_only else ""
    http.server.ThreadingHTTPServer((host, port), NoCacheHandler).serve_forever()
