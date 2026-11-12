# Video Dashboard 2.0 — mã nguồn nâng cấp

Gói này nâng cấp dự án hiện có tại `D:\editvideochatgpt`, dùng `public/input.mp4` và `src/scenes.json` hiện tại. Không chứa video gốc hoặc lời thoại của bạn.

## Có gì mới?

- Bấm thẻ cảnh: dừng phát và nhảy đến `Math.round(scene.start * fps)`.
- Preview dùng `@remotion/player` ngay trong Dashboard; không cần gửi lệnh qua iframe Studio.
- Sửa lời thoại, font, cỡ chữ, độ đậm, màu, viền chữ, màu/độ đậm nền theo từng cảnh.
- Kéo chữ trực tiếp trong Preview để thay vị trí; kéo ô vuông xanh sang trái/phải để giảm/tăng cỡ chữ.
- Thanh trượt vị trí ngang, khoảng cách tới đáy, chiều rộng khung phụ đề.
- Bốn kiểu xuất hiện: không hiệu ứng, hiện dần, phóng nhẹ, trượt lên.
- Tô dấu cảnh đang phát, tiến/lùi một frame, đặt lại định dạng, áp dụng định dạng cho tất cả cảnh.
- Lưu tất cả; Xuất MP4 tự lưu các cảnh đang sửa trước khi render.
- Job render có thời gian chạy và log, tiếp tục chạy ở server nếu đóng tab. Mở lại Dashboard sẽ nối lại theo dõi nếu server chưa khởi động lại.
- Kiểm tra phiên bản dữ liệu để tránh một tab ghi đè thay đổi vừa lưu ở tab khác.
- Đồng bộ Python có bản sao `scenes.json` trước khi chạy trong `out/backups`.

## 1. Dừng dịch vụ và sao lưu

Trong cửa sổ Node và Remotion cũ, nhấn Ctrl+C. Sao lưu các file sắp thay: `server/server.js`, `server/public/index.html`, `src/Composition.tsx`, `src/Root.tsx`, và `src/scenes.json`.

Giải nén gói này vào một thư mục tạm. Copy thư mục `server`, thư mục `skill1` và file `setup_v2.bat` vào `D:\editvideochatgpt`, chọn hợp nhất thư mục và ghi đè các file trùng tên. Không xóa thư mục dự án cũ.

Các đường dẫn dưới đây tính từ `D:\editvideochatgpt`:

| File | Thao tác | Vai trò |
|---|---|---|
| `server/server.js` | Ghi đè | API lưu, job render, biên dịch Dashboard |
| `server/public/index.html` | Ghi đè | Trang khởi động Dashboard |
| `server/public/dashboard.css` | Thêm | Giao diện ba cột |
| `skill1/03_PROJECT/my-editor/dashboard/App.tsx` | Thêm | Player và các công cụ chỉnh sửa |
| `skill1/03_PROJECT/my-editor/src/Composition.tsx` | Ghi đè | Video, phụ đề, kéo/đổi cỡ, hiệu ứng |
| `skill1/03_PROJECT/my-editor/src/Root.tsx` | Ghi đè | Đăng ký Composition dùng chung cấu hình |
| `skill1/03_PROJECT/my-editor/src/editor-model.ts` | Thêm | Kiểu dữ liệu và định dạng mặc định |
| `skill1/03_PROJECT/my-editor/src/video-config.json` | Thêm | FPS, kích thước, thời lượng |
| `setup_v2.bat` | Thêm | Cài dependency đúng phiên bản |

Giữ nguyên `src/index.ts`, `scenes.json`, `public/input.mp4`, `build_scenes.py`, `whisper.json`, `package.json`, `tsconfig.json` và `remotion.config.ts` hiện có. Script setup sẽ cập nhật dependency trong package.json/package-lock.json.

## 2. Cài dependency một lần

Nhấp đúp `D:\editvideochatgpt\setup_v2.bat`. Script lấy phiên bản Remotion đang cài để cài `@remotion/player` cùng phiên bản, cài esbuild và kiểu ReactDOM tương ứng, rồi kiểm tra TypeScript.

Với phiên bản đã đọc được trên máy bạn là Remotion **4.0.542**, React **19**, lệnh CMD tương đương là:

```cmd
cd /d D:\editvideochatgpt\skill1\03_PROJECT\my-editor
npm install --save-exact @remotion/player@4.0.542
npm install --save-dev esbuild @types/react-dom@19
npx tsc --noEmit
```

Không cài `@remotion/player@latest` riêng khi các package Remotion khác đang ở phiên bản cũ.

Nếu TypeScript còn báo lỗi từ file khác của dự án, đọc đường dẫn trong thông báo; không xóa mã của bạn để bỏ qua lỗi.

## 3. Kiểm tra cấu hình video

`src/video-config.json` khớp Root.tsx đã đọc được:

```json
{"width":1080,"height":1920,"fps":30,"durationInFrames":1148}
```

Player và file MP4 dùng chung cấu hình này. 1.148 frame ở 30 fps tương đương khoảng 38,27 giây. Đây là thời lượng Composition hiện có, không phải kết quả tự đo video nguồn. Nếu cần đổi độ dài, sửa `durationInFrames = Math.ceil(số_giây * fps)` rồi khởi động lại Node và tải lại Dashboard. Không suy thời lượng toàn video chỉ từ phụ đề cuối.

## 4. Chạy

Dùng `run_dashboard.bat` hiện có. Hoặc chạy hai cửa sổ CMD:

```cmd
cd /d D:\editvideochatgpt\server
node server.js
```

```cmd
cd /d D:\editvideochatgpt\skill1\03_PROJECT\my-editor
npm run dev -- --port=3000 --no-open
```

Mở http://127.0.0.1:3001 rồi Ctrl+F5. Lần đầu chờ dòng `Dashboard 2.0` trong terminal. Server tự tạo `server/public/dashboard.js`; không cần tự viết file này. Khi sửa mã TSX/CSS, khởi động lại Node rồi tải lại trang.

Preview mới và Render hoạt động qua cổng 3001; cổng 3000 dùng khi bấm “Mở Studio”. Không mở index.html trực tiếp bằng nhấp đúp.

## 5. Cách dùng

1. Bấm tiêu đề hoặc nền một thẻ cảnh. Player dừng và nhảy tới đầu câu. Thao tác gõ trong textarea đang chọn không liên tục nhảy lại đầu cảnh.
2. Khi bật “Chỉnh vị trí”, kéo phần chữ trong Preview. Ô vuông xanh ở góc dưới bên phải cho phép kéo ngang để chỉnh fontSize. Vị trí được tính theo kích thước video thật, không theo số pixel của Preview thu nhỏ.
3. Dùng bảng bên phải để đổi font, màu, nền, viền và hiệu ứng. Thay đổi được xem ngay; bấm “Lưu tất cả” để ghi xuống file.
4. Bấm Play trên thanh điều khiển Player để xem hiệu ứng và âm thanh. Chế độ chỉnh vị trí tự tắt khi phát. Trong chế độ chỉnh vị trí, phụ đề được hiện đầy đủ để dễ kéo kể cả đầu hiệu ứng fade.
5. Bấm “Xuất MP4”. API lưu các thay đổi và khóa thao tác ghi trong cùng một yêu cầu, sau đó bắt đầu render. Xem số giây đã chạy và “Log tác vụ”; số giây không phải phần trăm hoàn thành.
6. Khi hoàn tất, bấm “Tải video.mp4” hoặc mở `D:\editvideochatgpt\skill1\03_PROJECT\my-editor\out\video.mp4`.

Lưu nhiều cảnh diễn ra bằng một lần thay file JSON, nên một cảnh sai dữ liệu không làm lưu nửa chừng. Mốc `start/end`, ID, cấu trúc mảng/wrapper và metadata khác được giữ nguyên.

Nếu hai tab chỉnh cùng dữ liệu, tab lưu sau sẽ nhận thông báo xung đột. Sao chép nội dung chưa lưu trước khi bấm Tải lại; bản này không tự trộn hai phiên sửa.

## 6. Cách dữ liệu hoạt động

Các thuộc tính mới được thêm trực tiếp vào từng cảnh khi lưu. Ví dụ minh họa (không thay scenes.json của bạn bằng ví dụ này):

```json
{
  "id": "s1",
  "start": 1.64,
  "end": 3.16,
  "text": "Mọi người có nghĩ nó vậy không?",
  "fontSize": 64,
  "positionX": 50,
  "positionY": 220,
  "maxWidth": 87,
  "fontFamily": "Tahoma",
  "fontWeight": 700,
  "color": "#ffffff",
  "backgroundColor": "#000000",
  "backgroundOpacity": 0.55,
  "strokeWidth": 2,
  "strokeColor": "#000000",
  "effect": "pop"
}
```

`positionX` là phần trăm chiều ngang tính từ mép trái, biểu thị tâm khung chữ. `positionY` là khoảng cách từ đáy video đến đáy khung chữ tính bằng pixel video. Vì vậy `positionY` và `fontSize` từ bản trước vẫn sử dụng được. `maxWidth` là phần trăm chiều rộng video.

Preview nhận các cảnh đang sửa qua Player `inputProps`. Studio và CLI đọc các cảnh đã lưu. Cả hai dùng cùng `MyComposition`, cùng quy tắc làm tròn frame và cùng hiệu ứng dựa trên `useCurrentFrame()`.

Các callback kéo/resize chỉ truyền từ Dashboard. Khi render, không truyền callback nên viền chọn và ô vuông xanh không xuất hiện trong MP4.

## 7. Giới hạn rõ ràng

- Kéo ô xanh thay đổi cỡ chữ; đây chưa phải bộ công cụ biến dạng/xoay/cắt lớp như CapCut.
- Các font trong menu là font hệ thống. Font phải được cài trên máy xem/render; nếu chuyển máy, font thay thế có thể làm cách xuống dòng khác. Muốn font riêng, cần bổ sung cơ chế nạp file font dùng chung.
- Hiệu ứng áp dụng cho cả câu. Karaoke từng từ cần timestamp từng từ; không tự tạo timestamp giả từ start/end của cả câu.
- Các thanh trượt cho phép đặt chữ gần mép; font lớn, khung hẹp hoặc vị trí sát mép có thể làm chữ vượt khung. Hãy kiểm tra Preview trước khi xuất.
- Không chỉnh timing, cắt video, nhạc nền, xoay chữ hoặc undo/redo trong bản này.
- Python sync có thể tạo lại cảnh và mất định dạng. Bản sao lưu là dữ liệu đã lưu trước sync; thay đổi chưa lưu trong trình duyệt không có trong backup.
- Trạng thái job ở bộ nhớ Node. Khởi động lại Node không khôi phục trạng thái tiến độ; kiểm tra thư mục out và log trước khi chạy lại.
- Tệp đang render là `out/video-rendering.mp4`. Khi thành công, server đổi thành `video.mp4`; nếu encoder lỗi, bản video.mp4 trước đó được giữ lại. Nếu Windows đang khóa MP4 vì ứng dụng khác mở nó, đóng ứng dụng đó rồi xuất lại.

## 8. Kiểm tra trước khi dùng chính thức

1. Chọn cảnh có start 1.64s ở 30 fps: phải đến frame 49.
2. Kéo chữ, đổi fontSize và màu; lưu; F5: giá trị phải còn nguyên.
3. Chọn một cảnh khác: định dạng vẫn độc lập.
4. Chọn hiệu ứng hiện dần, bật Play: hiệu ứng chạy theo khung hình.
5. Sửa câu chưa lưu rồi Xuất MP4: video phải dùng câu và định dạng mới, giữ âm thanh gốc, không có khung chọn màu xanh.
6. Mở hai tab, sửa/lưu ở tab A rồi lưu ở tab B: tab B phải báo xung đột.

Kiểm chứng khi đóng gói: esbuild đã biên dịch được; 16 kiểm tra logic API vượt qua, bao gồm hai dạng JSON, bảo toàn timing/metadata, ghi nguyên khối, kiểm tra dữ liệu, xung đột revision, khóa khi render và xử lý thành công/thất bại. Tiến trình encoder trong kiểm tra được mô phỏng, không xuất lại video thật. Kiểm tra TypeScript dùng khai báo tối thiểu cho API createRoot do môi trường kiểm tra không tải được @types/react-dom; script setup sẽ cài kiểu chính thức và chạy lại TypeScript trên máy bạn. Chưa xác nhận kéo thả bằng trình duyệt vì môi trường kiểm tra không kết nối được localhost.

## Tài liệu API

- https://www.remotion.dev/docs/player/player
- https://www.remotion.dev/docs/offthreadvideo

