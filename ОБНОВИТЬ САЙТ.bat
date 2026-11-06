@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JustClean - публикация сайта

echo ==================================================
echo    JustClean - публикация сайта
echo ==================================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto INIT
goto STEP1

:INIT
echo Первая настройка: связываю папку с GitHub...
git init -b main >nul 2>&1
git remote add origin https://github.com/rutasha2809-creator/justclean.git >nul 2>&1
git fetch origin
if errorlevel 1 goto NOREPO
git reset origin/main >nul 2>&1
git branch --set-upstream-to=origin/main main >nul 2>&1
echo          Готово.
echo.

:STEP1
echo [1 из 3] Проверяю, есть ли новые правки...
git add -A

git diff --cached --quiet
if errorlevel 1 goto COMMIT
echo          Новых правок нет - значит, всё уже сохранено.
goto SHOWLIST

:COMMIT
git commit -m "Обновление сайта %date% %time%" >nul 2>&1
if errorlevel 1 goto COMMITFAIL
echo          Правки сохранены.

:SHOWLIST
echo.
echo [2 из 3] Будет отправлено на GitHub:
git log --oneline origin/main..HEAD 2>nul
git diff --quiet origin/main HEAD 2>nul
if not errorlevel 1 goto NOTHING

echo.
echo [3 из 3] Отправляю...
git push -u origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo ==================================================
echo    ГОТОВО
echo ==================================================
echo.
echo Сайт обновится через 1-2 минуты:
echo https://rutasha2809-creator.github.io/justclean/
echo.
echo Если изменения не видно - обновите страницу
echo сочетанием клавиш Ctrl и F5.
echo.
pause
exit /b 0

:NOTHING
echo.
echo Отправлять нечего - на сайте уже всё свежее.
echo.
pause
exit /b 0

:NOREPO
echo.
echo ОШИБКА: не удалось связаться с GitHub.
echo Проверьте интернет и вход в GitHub.
echo.
pause
exit /b 1

:COMMITFAIL
echo.
echo ОШИБКА: не удалось сохранить правки.
echo Скопируйте текст выше и покажите его Claude.
echo.
pause
exit /b 1

:PUSHFAIL
echo.
echo ==================================================
echo    НЕ ПОЛУЧИЛОСЬ ОТПРАВИТЬ
echo ==================================================
echo.
echo Возможные причины:
echo  - нет интернета;
echo  - GitHub запросил логин или пароль;
echo  - кто-то менял файлы на GitHub - тогда сначала
echo    выполните: git pull
echo.
echo Скопируйте текст выше и покажите его Claude.
echo.
pause
exit /b 1
