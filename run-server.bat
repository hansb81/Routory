@echo off
rem TripLog 로컬 서버 실행 스크립트. 더블클릭하면 이 파일이 있는 폴더(D:\VibeCoding\Study_01)에서
rem serve.py를 실행한다 (triplog\ 폴더를 http://localhost:8080/ 으로 서비스한다).
rem
rem 사용법:
rem   run-server.bat            기본 실행 (포트 8080, 모든 네트워크에 열림 - 폰에서도 접속 가능)
rem   run-server.bat 8081       포트를 바꿔서 실행
rem   run-server.bat --local    이 PC에서만(127.0.0.1) 접속 가능하게 실행 (폰에서는 접속 안 됨)
rem
rem 창을 닫으려면 Ctrl+C를 누르거나 창을 그냥 닫으면 서버가 멈춘다.
rem 폰에서 접속하려면(--local을 안 붙인 기본 실행) 이 PC가 공인 IP를 직접 받는 환경이라 외부에서도
rem 접속될 수 있다 (CLAUDE.md 참고) - 다 쓰면 이 창을 닫아 서버를 멈추는 것이 좋다.

cd /d "%~dp0"
python serve.py %*

echo.
echo 서버가 멈췄습니다.
pause
