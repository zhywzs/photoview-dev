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
- **多级缩略图**:扫描管线生成 1024/256/128px 三档(mipmap),按 `瓦片尺寸 × DPR` 自动选择,密集视图带宽约 0.8KB/张
- **移动端**:底部导航、可展开搜索、工具栏横滑、灯箱照片双指缩放(1–5x)+ 平移 + 双击、safe-area 适配
- 时间线满屏展示(移动端负边距),移除筛选工具栏

### 4. 部署架构

- UI dev server 反向代理 `/api` 到 API(同源架构,**任意 IP 访问无 CORS/cookie 问题**),API 媒体 URL 改为相对路径
- 开发环境:WSL2 Ubuntu(源码构建 LibRaw + ImageMagick 7),systemd 服务管理;Windows 侧端口转发脚本(见仓库外 `ops/expose-photoview.ps1`)

## 开发环境

```
源码:WSL ~/photoview-dev/photoview(Windows 编辑副本 C:\D\codes\photoview-dev\photoview)
数据库:SQLite(~/photoview-dev/data/photoview.db)
服务:systemd 单元 photoview-api(:4001)/ photoview-ui(vite :1234)
访问:http://<任意本机IP>:1234(vite 代理 /api,同源)
```

常用操作(WSL 内):

```bash
sudo systemctl restart photoview-api photoview-ui   # 重启服务
cd ~/photoview-dev/photoview/api && go generate ./...   # gqlgen 代码生成
cd ~/photoview-dev/photoview/ui && npm run genSchemaTypes  # apollo TS 类型生成
go test ./graphql/... ./scanner/...                  # 后端测试
npx vitest run                                        # 前端测试
```

测试照片库:`~/photoview-dev/test-photos`(Bing 每日壁纸 + picsum,含 EXIF 日期/相机/GPS)

## 技术细节

- 设计文档:见仓库外 `C:\D\codes\photoview-dev\docs\优化设计文档-搜索与前端体验.md`(含完整方案、决策记录与实施结果)
- 网格布局/缩放锚点/日期分组均为纯函数(`ui/src/components/photoGrid/gridLayout.ts`、`timelineGrouping.ts`),配单元测试
- 前端测试 112 项全部通过,后端 `go vet` / `go test` 干净

## 许可

继承上游 [AGPL-3.0](./LICENSE.txt)
