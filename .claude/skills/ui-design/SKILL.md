---
name: ui-design
description: Bộ rule bắt buộc khi thiết kế hoặc chỉnh sửa giao diện (web page, dashboard, component, landing page, HTML/React/Next.js UI). Dùng TRƯỚC khi viết dòng CSS/JSX đầu tiên và khi review UI - bao gồm palette, typography, layout, theme sáng/tối, responsive, accessibility, copywriting và danh sách "dấu hiệu AI-generated" cần tránh.
---

# UI Design Rules

Tổng hợp từ các skill design chính thức của Claude Code (`frontend-design`, `artifact-design`).
Ký hiệu: **MUST** = bắt buộc, **SHOULD** = mặc định nên làm, **AVOID** = chỉ dùng khi brief yêu cầu rõ.

## 0. Thứ tự ưu tiên

1. Lời yêu cầu của user (kể cả khi user muốn đúng một look "cliché" - làm theo chính xác).
2. Design system có sẵn của project: tokens/theme file, Tailwind config, component styles, CLAUDE.md.
3. Rule trong file này - chỉ lấp chỗ trống, không bao giờ ghi đè 1 và 2.

## 1. Xác định bài toán trước khi vẽ

- **MUST** chốt: một subject cụ thể, audience, và *một* nhiệm vụ chính của màn hình. Brief thiếu thì tự đề xuất rồi xác nhận.
- **MUST** chọn mức treatment:
  - *Utilitarian* (plan, memo, demo, tool nội bộ, dashboard): gọn, có hierarchy, spacing và palette chỉn chu - không hero khổng lồ, không flourish.
  - *Editorial* (landing page, game, sản phẩm để share): có quan điểm thẩm mỹ rõ, chấp nhận một rủi ro thẩm mỹ có chủ đích.
  - Không chắc → một trang bố cục tốt không bao giờ sai; over-design thì có thể sai.
- **MUST** dùng nội dung thật (thuật ngữ, đơn vị, quy ước của domain) - không lorem ipsum. Mỗi thiết kế có ít nhất một chi tiết chỉ subject này mới có, dưới dạng nội dung chứ không phải trang trí.

## 2. Design plan (viết trước khi code)

- **Color**: 4-6 màu có tên + mã hex (ground, surface, text, muted, accent, + semantic nếu cần).
- **Type**: typeface cho từng vai trò (display dùng tiết chế / body / utility cho data nếu cần).
- **Layout**: 1-2 câu mô tả concept, kèm alignment (trái/giữa); với layout phức tạp phác ASCII wireframe.
- **Principles**: điều gì làm màn hình này khác một template bất kỳ.
- **MUST** tự review plan: phần nào trông giống kết quả mặc định cho *bất kỳ* trang tương tự → sửa và ghi lại lý do. Chỉ code sau bước này.

## 3. Color & theme

- **MUST** định nghĩa màu bằng token (CSS variables / theme), component chỉ dùng token - không literal màu rải rác.
- **SHOULD** neutral có hue nghiêng nhẹ về accent; xám trung tính thuần trông như chưa được chọn.
- **MUST** `body` có background tường minh từ token (không để transparent).
- **MUST** thiết kế cả light và dark theo 3 trạng thái:
  ```css
  :root { /* toàn bộ palette light */ }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* chỉ redefine token */ }
  }
  :root[data-theme="dark"] { /* redefine token lần nữa */ }
  ```
  Mọi token phải được khai báo trong `:root` trần trước; không màu nào chỉ tồn tại trong block media/`[data-theme]`. Dark theme không phải invert máy móc - kiểm tra contrast và accent trên cả hai nền.
- Chỉ bỏ dark mode khi đó là *lựa chọn* một thế giới hình ảnh duy nhất - khi đó vẫn paint background và mọi màu tường minh.
- **MUST** semantic color (success / warning / critical) tách biệt khỏi accent.
- **MUST** contrast đạt WCAG AA (4.5:1 text thường, 3:1 text lớn/UI).

## 4. Typography

- **MUST** có type scale cố định và bám theo nó; weight, width, spacing có chủ đích.
- **SHOULD** 1-2 family; nếu 2 thì phải khác biệt rõ. Chọn có lý do, không phải family "an toàn" dùng cho mọi project.
- **MUST** luôn có fallback stack thật; font load không được fallback im lặng.
- **MUST** độ dài dòng body ~65 ký tự (tối đa < 80); serif cho line-height rộng hơn sans một chút.
- **SHOULD** heading dùng `text-wrap: balance`; cột số dùng `font-variant-numeric: tabular-nums`.
- **AVOID** accent đúng một từ trong headline (in nghiêng/đậm/đổi màu), ALL CAPS cho mọi label, label thừa phía trên nội dung.

## 5. Layout & spacing

- **MUST** nhóm anh em dùng flex/grid + `gap`, không margin từng phần tử.
- **MUST** gutter ngang ≥ 16px ở mọi width, đặt một lần trên `body`/wrapper ngoài (vertical dùng `padding-block`).
- **MUST** responsive xuống ~400px: row wrap hoặc stack 1 cột; ảnh và box `aspect-ratio` có `max-width: 100%`; không `min-width` lớn hơn màn hình.
- **MUST** body không bao giờ scroll ngang; chỉ table / code / diagram được rộng hơn, mỗi cái trong container `overflow-x: auto` riêng.
- **MUST** text dài hơn track thì wrap hoặc scroll trong container của nó - text bị cắt là bug.
- **SHOULD** app một màn hình dùng `height: 100%` thay vì `100vh`; header sticky/bar fixed cộng `env(safe-area-inset-*)`.
- Hero sized theo nội dung, không theo viewport.
- **MUST** kiểm soát CSS specificity: không để class kiểu `.section` và `.cta` triệt tiêu padding/margin của nhau.

## 6. Composition & hierarchy

- **MUST** phần tử lặp (card trong hàng, cặp label/value, badge) căn cùng cạnh, cùng baseline, cùng padding; phần tử lặp lại nằm cùng vị trí ở mỗi item.
- **MUST** nội dung quyết định chiều cao; chọn số cột mà item lấp đầy - không item đứng lẻ loi, không khoảng trống chết.
- **Không phải cái gì cũng là card.** Border, fill, radius, shadow đều nói "đây là object riêng" - dùng theo vai trò, nâng đúng thứ cần nâng.
- **Structure là thông tin.** Numbering, eyebrow, divider, label phải mã hoá điều có thật. Chỉ đánh số 01/02/03 khi nội dung thực sự là một chuỗi tuần tự.
- Big-number tiles chỉ khi con số chính là mục đích của trang.
- **Tiết chế:** dồn sự táo bạo vào *một* chỗ, mọi thứ xung quanh yên tĩnh. Trước khi xong, bỏ bớt một "phụ kiện".

## 7. Khi là UI vận hành (dashboard, tool)

- Summary trước, detail sau.
- **MUST** mã hoá trạng thái bằng hình thức, không chỉ bằng số: pill, chip, severity stripe - thứ cần chú ý phải đọc được trong một cái liếc.
- Thứ tương tác được phải *trông* tương tác được.
- **MUST** mở ra ở trạng thái làm việc thực tế (data thật, hoặc sample được đánh dấu rõ là ví dụ) - không phải cái vỏ rỗng chờ input.
- Empty state là lời mời hành động, không phải khoảng trắng.

## 8. Chart & data viz

- **MUST** một scale duy nhất đặt mark, tick và label; mọi label là giá trị chart thực sự đạt tới.
- **MUST** màu chữ của chart lấy từ theme token (đọc được ở cả 2 theme).
- Mark, label, cạnh không chồng nhau và nằm trong bounds; SVG chừa chỗ trong viewBox cho label ngoài cùng, mọi shape có `fill` tường minh.
- Sparkline/chart được chăm như type: area fill, grid mờ, nhấn endpoint.

## 9. Motion

- **MUST** tôn trọng `prefers-reduced-motion`.
- **MUST** trang ở trạng thái nghỉ đã hiển thị đầy đủ: không để section `opacity: 0` chờ IntersectionObserver.
- **SHOULD** motion không do user kích hoạt dùng rất ít - một khoảnh khắc được dàn dựng tốt hơn hiệu ứng rải rác.
- Motion phản hồi hành động (mở, expand, xác nhận) được khuyến khích khi nó cho thấy cái gì vừa thay đổi.
- **AVOID** fade-slide-up cho từng section, hover transition trên mọi card.

## 10. Accessibility & build sạch

- **MUST** keyboard focus có trạng thái hiển thị rõ.
- **MUST** mọi form control có `id` ổn định và label.
- **MUST** HTML đóng thẻ đầy đủ, attribute dùng dấu nháy kép; kiểm tra phần tử chồng lấn.
- **SHOULD** graphic trang trí/generative dùng Canvas/WebGL thay vì path SVG dài viết tay.
- **SHOULD** load thư viện (UMD, version pin cố định) thay vì paste source hoặc tự viết stand-in; phần lớn trang không cần thư viện.

## 11. Copywriting

- Viết từ phía người dùng: gọi tên theo thứ họ nhận ra ("thông báo", không phải "webhook config").
- Active voice, sentence case, động từ rõ, không filler; mỗi đoạn chữ làm đúng một việc.
- CTA nói chính xác điều sẽ xảy ra: "Lưu thay đổi", không phải "Submit". Một hành động giữ cùng tên suốt flow ("Publish" → toast "Published").
- Error: nói rõ chuyện gì sai và cách sửa - không xin lỗi, không mơ hồ.
- Cụ thể thắng khéo léo.
- Page/app title là một cái tên (2-4 từ, đặc trưng cho subject), không phải "Tên: giải thích".

## 12. Dấu hiệu "AI-generated" - AVOID khi brief không chỉ định

1. Nền kem ấm (~`#F4F1EA`) + serif display tương phản cao + accent terracotta/đất nung (~`#D97757`).
2. Nền gần đen + một accent xanh acid hoặc đỏ son duy nhất.
3. Layout báo giấy: hairline rule, radius 0, cột dày đặc.
4. SaaS-card kit: nội dung chặt thành card giống hệt, một `rounded-lg` cho mọi thứ, cùng shadow xám `rgba(0,0,0,.1)`, gradient wash trang trí; accent bar/rail trên card bo góc.
5. Hero gradient tím → xanh trên nền trắng.
6. Inter hoặc Space Grotesk làm font "an toàn".
7. Emoji làm marker cho section; mọi thứ căn giữa.
8. Template chrome: eyebrow ALL-CAPS giãn chữ trên mọi heading; meta nối bằng chấm giữa `A · B · C`; label kiểu `WORD — fragment`; near-black `#0B0B0B`/`#111` thay cho đen; monospace cho label data nhỏ; `→` gắn vào text link/button.
9. Hero mặc định: số to + label nhỏ + stats phụ + gradient accent.

Những trait này hợp lệ với *một số* brief - vấn đề là chúng xuất hiện như mặc định bất kể subject.

## 13. Quy trình

1. Đọc yêu cầu → chọn treatment (mục 1).
2. Tìm design system có sẵn trong project (mục 0).
3. Viết design plan (mục 2) → tự review với danh sách mục 12 → sửa.
4. Code theo plan, mọi màu/type lấy từ token.
5. Nhìn render **một lần** (screenshot nếu môi trường hỗ trợ) → một lượt sửa → xong. Không lặp vòng screenshot vô tận.

## Checklist trước khi bàn giao

- [ ] Có design plan, đã loại các default ở mục 12
- [ ] Màu qua token; light + dark đúng pattern 3 trạng thái; `body` có background
- [ ] Contrast AA; focus visible; `prefers-reduced-motion`
- [ ] Type scale nhất quán; fallback font; dòng ≤ ~65-80 ký tự
- [ ] Không scroll ngang ở 400px; gutter ≥ 16px; không text bị cắt
- [ ] Phần tử lặp thẳng hàng; card/shadow/radius dùng theo vai trò
- [ ] Numbering/eyebrow/label mang thông tin thật
- [ ] Nội dung thật, copy rõ ràng, CTA nói đúng hành động
- [ ] Trạng thái ban đầu hiển thị đầy đủ, có data/sample thực tế
