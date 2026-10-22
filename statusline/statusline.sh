#!/bin/bash
# plan-limits 自带的状态栏：当前目录、模型和 effort，配色取自 Catppuccin Mocha（真彩色）。
# 上下文、5 小时和每周额度由 mod 画在输入框上方，这里不再重复。
# Claude Code 把会话信息以 JSON 从 stdin 传进来；有 jq 用 jq 解析，没有就退回用 sed。

input=$(cat)

# 取第一个 "key": "value" 的值（没有 jq 时用），并还原 JSON 里转义的反斜杠和引号
field() {
    printf '%s' "$input" | tr -d '\n' \
        | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\\\]\|\\\\.\)*\)\".*/\1/p" \
        | head -n 1 | sed 's/\\\\/\\/g; s/\\"/"/g'
}

if command -v jq >/dev/null 2>&1; then
    dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty')
    model=$(printf '%s' "$input" | jq -r '.model.display_name // empty')
    effort=$(printf '%s' "$input" | jq -r '.effort.level // empty')
else
    dir=$(field current_dir)
    [ -z "$dir" ] && dir=$(field cwd)
    model=$(field display_name)
    effort=$(field level)
fi
[ -z "$dir" ] && dir=$(pwd)

rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }
C_DIR=$(rgb 137 180 250)    # blue     #89b4fa
C_MODEL=$(rgb 203 166 247)  # mauve    #cba6f7
C_SEP=$(rgb 108 112 134)    # overlay0 #6c7086
RESET='\033[0m'

# effort 按强度从冷到暖着色
case "$effort" in
    low)    C_EFFORT=$(rgb 166 227 161) ;;  # green  #a6e3a1
    medium) C_EFFORT=$(rgb 249 226 175) ;;  # yellow #f9e2af
    high)   C_EFFORT=$(rgb 250 179 135) ;;  # peach  #fab387
    *)      C_EFFORT=$(rgb 243 139 168) ;;  # red    #f38ba8 (xhigh / max)
esac

printf '%b%s%b' "$C_DIR" "$dir" "$RESET"

info=""
[ -n "$model" ] && info="$C_MODEL$model$RESET"
if [ -n "$effort" ]; then
    [ -n "$info" ] && info="$info $C_SEP·$RESET "
    info="$info$C_EFFORT$effort$RESET"
fi

[ -n "$info" ] && printf '  %b' "$info"
printf '\n'
