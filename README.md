# Photoview(定制开发版)

基于开源项目 [photoview/photoview](https://github.com/photoview/photoview) 的定制版本,保留其"目录即相册"的扫描管线与 Go + React 架构,围绕**搜索能力**与**移动端浏览体验**做了大量重写。

> 原版文档见 [README.upstream.md](./README.upstream.md)

## 主要改动

### 1. 搜索增强

| 能力 | 说明 |
|---|---|
| 全字段搜索 | `search` 从仅匹配文件名/路径,扩展到 EXIF(相机/厂商/镜头/描述)与人脸标签,返回新增 `faceGroups`;修复上游相册搜索大小写 bug |
| 日期筛选 | 新增 `filterMedia(query, dateFrom, dateTo, location, onlyFavorites)` 通用筛选查询;`myTimeline` 增加 `toDate`,语义修正为闭区间 |
| 地点搜索 | 新增 `GeoBoundingBox` 边界框筛选(EXIF GPS);搜索页提供按坐标聚类的地点下拉 |
| 修复上游 bug | `exif_task.go` 中 EXIF 拍摄时间先 Save 后赋值导致从未写库(date_shot 一直是文件时间),已修复并回填存量数据 |

### 2. 相册与收藏

- 相册重命名:`setAlbumTitle` mutation(仅改数据库标题,不动磁盘目录)+ 相册侧栏重命名入口
- 收藏页:`/favorites` 路由 + 底部导航入口

### 3. 前端全面重做(photoGrid 组件族)

- **四档列数缩放**(每行 3 / 5 / 15 / 30 张):双指捏合**逐帧跟手**(对网格容器施加 CSS transform,1:1 跟踪手指张合,零布局开销);视觉尺寸跨过相邻档位的几何中点时新档位布局接管(排序 + 按需加载),残余缩放折叠进跟手基准保证接管零跳变,松手回弹归位;双击疏密切换、Ctrl+滚轮换档,均带锚点残余过渡;亚行精度锚点算法保持手指下的照片位置稳定
- **自适应日期分组**:3/5 列按天/跨天合并(以铺满屏幕为目标),15/30 列按自然月;3/5 列显示粘性日期条(点击可按时间段筛选),15/30 列日期改为**浮动 pill**(滚动时显示,停止 1s 淡出)
- **无缝密集视图**:15/30 列所有照片扁平化为一个连续大块,gap=0 + flex 弹性宽度,严格边到边填满屏幕
- **虚拟化渲染**:窗口滚动 + 分区分行虚拟化(自研,无依赖),任意数量照片 DOM 恒定
- **多级缩略图 + 图集**:扫描管线生成 1024/256/128px 三档缩略图;**缩略图图集**(Atlas)按用户打包照片为 1024×1024 JPEG 精灵图——128px/格(8×8,64 张/图集)服务 15/30 列,256px/格(4×4,16 张/图集)服务 3/5 列,全档位整屏图片仅需个位数 HTTP 请求(3 列从 ~20 请求 940KB 降至 2 请求 260KB);扫描完成后自动重建,设置页可手动重新生成;网格视图偏重性能(细节查看走灯箱高清图)
- **移动端**:底部导航、可展开搜索、safe-area 适配;灯箱(全屏预览)支持**跟手左右翻页**(三页轨道,邻图随手指滑入,支持甩动翻页与回弹)、**下滑关闭**(图片跟手下坠缩小+变暗淡出)、**信息面板**(移动端底部可拖拽 sheet / 桌面侧边抽屉,自动按需查询 EXIF 与相册路径)与照片双指缩放(1–5x)+ 平移 + 双击
- 时间线满屏展示(移动端负边距),移除筛选工具栏

### 4. 部署架构

- UI dev server 反向代理 `/api` 到 API(同源架构,**任意 IP 访问无 CORS/cookie 问题**),API 媒体 URL 改为相对路径
- 开发环境:WSL2 Ubuntu(源码构建 LibRaw + ImageMagick 7),systemd 服务管理;Windows 侧端口转发脚本(见仓库外 `ops/expose-photoview.ps1`)

## 部署指南(WSL2,无需 Docker)

以下是在 Windows + WSL2 中从零部署本项目的完整步骤(在本机 Ubuntu 24.04 上验证通过)。API 依赖 CGO 编译的 C 库(ImageMagick 7 / dlib / SQLite),而 apt 源只有 ImageMagick 6,因此需要源码构建 IM7。

### 1. 安装 WSL2 与 Ubuntu

```powershell
# Windows PowerShell(管理员)
wsl --install -d Ubuntu-24.04
```

### 2. 系统依赖(WSL 内)

```bash
sudo apt update

# 构建工具
sudo apt install -y build-essential autoconf automake libtool pkg-config \
  curl jq ca-certificates git sqlite3

# ImageMagick 7 的 delegate 库
sudo apt install -y libbz2-dev libdjvulibre-dev libfftw3-dev libheif-dev \
  libjbig-dev libjpeg-dev libjxl-dev liblcms2-dev liblzma-dev libopenexr-dev \
  libopenjp2-7-dev libpng-dev libtiff-dev libwebp-dev libwmf-dev \
  libxml2-dev libzip-dev libzstd-dev zlib1g-dev

# 人脸识别(go-face 需要 dlib)
sudo apt install -y libdlib-dev libblas-dev liblapack-dev

# 运行时外部工具(视频转码 / EXIF 解析)
sudo apt install -y ffmpeg libimage-exiftool-perl

# Node.js 18(Ubuntu 24.04 自带 18.19)
sudo apt install -y nodejs npm
```

### 3. 源码构建 LibRaw + ImageMagick 7

```bash
# LibRaw(最新版)
ver=$(curl -fsSL https://api.github.com/repos/LibRaw/LibRaw/releases/latest | jq -r .tag_name)
curl -fsSL -o /tmp/libraw.tar.gz "https://api.github.com/repos/LibRaw/LibRaw/tarball/${ver}"
mkdir /tmp/libraw && tar xf /tmp/libraw.tar.gz -C /tmp/libraw --strip-components=1
cd /tmp/libraw
autoreconf --install
./configure --enable-shared --enable-openmp --enable-jpeg --enable-zlib --enable-lcms \
  --disable-examples --prefix=/usr/local
make -j$(nproc) && sudo make install && sudo ldconfig

# ImageMagick 7(必须 7,imagick.v3 CGO 绑定不兼容 IM6)
ver=$(curl -fsSL https://api.github.com/repos/ImageMagick/ImageMagick/releases/latest | jq -r .tag_name)
curl -fsSL -o /tmp/im7.tar.gz "https://api.github.com/repos/ImageMagick/ImageMagick/tarball/${ver}"
mkdir /tmp/im7 && tar xf /tmp/im7.tar.gz -C /tmp/im7 --strip-components=1
cd /tmp/im7
./configure --enable-shared --enable-delegate-build \
  --with-bzlib --with-djvu --with-heic --with-jbig --with-jpeg --with-jxl \
  --with-lcms --with-lzma --with-openexr --with-openjp2 --with-png --with-raw \
  --with-tiff --with-webp --with-wmf --with-xml --with-zip --with-zstd \
  --without-x --without-magick-plus-plus --without-perl --prefix=/usr/local
make -j$(nproc) && sudo make install && sudo ldconfig
magick -version   # 确认输出 7.x
```

### 4. 安装 Go(≥ 1.27)

apt 的 Go 版本过旧,从官方安装:

```bash
ver=$(curl -fsSL https://go.dev/VERSION?m=text | head -1)   # 如 go1.27.x
curl -fsSL -o /tmp/go.tgz "https://go.dev/dl/${ver}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz
sudo ln -sf /usr/local/go/bin/go /usr/local/bin/go
go version
```

### 5. 编译 API

```bash
git clone <本仓库> ~/photoview-dev/photoview
cd ~/photoview-dev/photoview/api

# 网络不通时使用国内代理
export GOPROXY=https://goproxy.cn,direct

go mod download

# go-face 补丁:Ubuntu 无 libcblas.so,符号由 libblas 覆盖
chmod -R u+w $(go env GOMODCACHE)/github.com/\!kagami
sed -i 's/-lcblas//g' $(go env GOMODCACHE)/github.com/\!kagami/go-face*/face.go

CGO_ENABLED=1 go build -o photoview-api .
```

### 6. 配置环境

**`api/.env`**(关键项,注意本定制版使用**相对路径**端点):

```ini
PHOTOVIEW_DATABASE_DRIVER=sqlite
PHOTOVIEW_SQLITE_PATH=/home/<user>/photoview-dev/data/photoview.db

PHOTOVIEW_LISTEN_IP=0.0.0.0
PHOTOVIEW_LISTEN_PORT=4001

# 相对端点:媒体 URL 生成 /api/photo/...,跟随访问者使用的任意 IP(同源架构)
PHOTOVIEW_API_ENDPOINT=/api
PHOTOVIEW_UI_ENDPOINTS=http://localhost:1234

PHOTOVIEW_SERVE_UI=0
PHOTOVIEW_DEVELOPMENT_MODE=1
```

**`ui/.env`**:留空即可(不设 `REACT_APP_API_ENDPOINT`,UI 使用自身 origin,vite 代理 `/api` 到后端,任意 IP 访问无 CORS/cookie 问题)。

代理已内置在 `ui/vite.config.js` 的 `server.proxy`。

```bash
mkdir -p ~/photoview-dev/data
cd ~/photoview-dev/photoview/ui && npm ci
```

### 7. systemd 服务

```bash
sudo tee /etc/systemd/system/photoview-api.service <<'EOF'
[Unit]
Description=Photoview API (dev)
After=network.target

[Service]
User=<你的用户名>
WorkingDirectory=/home/<user>/photoview-dev/photoview/api
ExecStart=/home/<user>/photoview-dev/photoview/api/photoview-api
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/photoview-ui.service <<'EOF'
[Unit]
Description=Photoview UI dev server (vite)
After=network.target photoview-api.service

[Service]
User=<你的用户名>
WorkingDirectory=/home/<user>/photoview-dev/photoview/ui
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now photoview-api photoview-ui
```

### 8. Windows 侧端口转发(可选,供局域网/手机访问)

WSL2 是 NAT 网络,外部流量需经 Windows 转发(管理员 PowerShell):

```powershell
$wslIp = (wsl -d Ubuntu-24.04 hostname -I).Trim().Split(' ')[0]
foreach ($port in 1234, 4001) {
    netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 `
        connectport=$port connectaddress=$wslIp
    New-NetFirewallRule -DisplayName "Photoview port $port" `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port
}
```

WSL 重启后 IP 会变,需重跑上述命令(可注册为登录计划任务自动刷新)。之后 `http://<任意本机IP>:1234` 即可访问。

### 常用操作(WSL 内)

```bash
sudo systemctl restart photoview-api photoview-ui       # 重启服务
cd ~/photoview-dev/photoview/api && go generate ./...   # gqlgen 代码生成
cd ~/photoview-dev/photoview/ui && npm run genSchemaTypes  # apollo TS 类型生成
cd ~/photoview-dev/photoview/api && go test ./graphql/... ./scanner/...  # 后端测试
cd ~/photoview-dev/photoview/ui && npx vitest run        # 前端测试
```

### 目录说明

```
~/photoview-dev/
├── photoview/        # 本仓库(API 源码 + UI 源码 + 编译产物)
├── data/             # SQLite 数据库(与仓库分离,重编译不丢数据)
└── test-photos/      # 测试照片库(可选,含 EXIF 日期/相机/GPS)
```

**Windows ↔ WSL 路径映射**:WSL 文件系统在 Windows 侧为 `\\wsl.localhost\Ubuntu-24.04\home\<user>\...`(资源管理器地址栏可直接访问)。本开发流程以 Windows 侧副本为编辑源、rsync 单向同步到 WSL,直接修改 WSL 侧文件会被下次同步覆盖。

### 将 Windows 图片目录接入 Photoview

Windows 驱动器在 WSL 中已自动挂载(`/mnt/c`、`/mnt/d`…),无需额外操作:

```bash
# 1. 确认路径可见
ls /mnt/d/Pictures            # 对应 D:\Pictures

# 2. (推荐)做个软链接,路径更干净
ln -s /mnt/d/Pictures ~/photos
ls ~/photos                   # 验证
```

**3. 添加为相册根路径**(两种方式任选):

- 网页:设置 → Users → 编辑用户 → Root paths 添加 `/home/<user>/photos`(或直接 `/mnt/d/Pictures`)→ 保存
- GraphQL:

```bash
curl -X POST http://localhost:4001/api/graphql \
  -H 'Content-Type: application/json' \
  -H 'Cookie: auth-token=<24位token>' \
  -d '{"query":"mutation { userAddRootPath(id: 1, rootPath: \"/mnt/d/Pictures\") { id username } }"}'
```

**4. 触发扫描**:设置页点 Scan All。Windows 侧照片按目录结构生成相册。

注意事项:

| 事项 | 说明 |
|---|---|
| 性能 | `/mnt/*` 走 9P 协议,**首次扫描慢**(每张照片跨文件系统读 EXIF + 生成缩略图,万张级可能需几十分钟);之后浏览走 WSL 内缩略图缓存,不受影响 |
| 缓存位置 | 缩略图缓存在 WSL ext4 内(`~/photoview-dev/photoview/api/media_cache`),**不要**挪到 /mnt |
| 改动同步 | Windows 侧增删照片后需再 Scan All(或设置周期扫描)才会反映 |
| 大小写 | Windows 文件系统不区分大小写,同一目录用不同大小写路径添加两次会生成重复相册,路径必须完全一致 |
| 外接硬盘 | 移动硬盘须在 WSL 启动前已连接,否则 `/mnt` 下不可见 |
| 大库优化 | 数万张以上且频繁全量重扫可迁入 WSL 原生文件系统(ext4,IO 快一个数量级),Windows 侧改用 `\\wsl.localhost\...` 访问 |

## 技术细节

- 网格布局/缩放锚点/日期分组均为纯函数(`ui/src/components/photoGrid/gridLayout.ts`、`timelineGrouping.ts`),配单元测试
- 前端测试 122 项全部通过,后端 `go vet` / `go test` 干净

## 许可

继承上游 [AGPL-3.0](./LICENSE.txt)
