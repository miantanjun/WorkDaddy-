#!/usr/bin/env bash
# 编译自维护的 Go 网关（WorkDaddy 的 sidecar）。
#
# 用法：bash vendor/wb2api-go/build.sh
# 产物：vendor/wb2api-go/dist/wb2api.exe
#
# 说明：
#   - Go 工具链是便携版，装在 %APPDATA%\WorkDaddy\golang\go，不动系统 PATH。
#   - GOPATH/GOCACHE 同级隔离，依赖缓存在 gopath/pkg/mod，换机器首次编译会重新下载。
#   - GOPROXY 用 goproxy.cn（官方 proxy.golang.org 在部分网络下不可达）。
#   - 必须 unset HTTP_PROXY：环境里常驻的 127.0.0.1:10298 会让 go mod download 失败。
set -e

GOLANG_HOME="${WD_GOLANG_HOME:-C:/Users/Lyon/AppData/Roaming/WorkDaddy/golang}"
export GOROOT="$GOLANG_HOME/go"
export GOPATH="$GOLANG_HOME/gopath"
export GOMODCACHE="$GOPATH/pkg/mod"
export GOCACHE="$GOLANG_HOME/gocache"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
export GOFLAGS="-mod=mod"
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

cd "$(dirname "$0")"
mkdir -p dist

echo "[1/3] go version"
"$GOROOT/bin/go.exe" version

echo "[2/3] 拉依赖"
"$GOROOT/bin/go.exe" mod download

echo "[3/3] 编译"
"$GOROOT/bin/go.exe" build -trimpath -ldflags "-s -w" -o dist/wb2api.exe ./cmd/server

ls -lh dist/wb2api.exe
echo "完成：$(pwd)/dist/wb2api.exe"
