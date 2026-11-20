/**
 * `LIQUID_SEGMENT_SHADER` —— `ui/components/LiquidSegmentShader.kt` L4-103 的 GLSL ES 3.00 版。
 *
 * Kotlin 用的是 Android AGSL（`RuntimeShader`）；AGSL 本身是 GLSL ES 3.00 的子集 +
 * `shader`/`eval()` 取样语法。这里的差别只有三处，全部是语法层，数学一值未改：
 *
 *   L5-6  `uniform shader track; uniform shader labels;`  → `uniform sampler2D uTrack; uLabels;`
 *   L47   `track.eval(p * density)`                       → `texture(uTrack, (p * density) * uInvPx)`
 *   L59   `half4 main(float2 pixel)`                      → `void main()` + `gl_FragCoord.xy`
 *
 * 其余 uniform 名、常量（`.09` 按压高度、`.16` 方向压扁、`11.0`/`9.0` smooth-min、
 * `17.0` 折射位移、`30.0`/`22.0` 高光指数、`.62→1.0` drop alpha）逐字保留。
 *
 * 渲染路径：`src/ui/components/LiquidSegmentedSelector.tsx` 的 `LiquidSegmentView` 优先建
 * WebGL2 上下文编译本串；不可用（WKWebView 低电量模式、GL 上下文耗尽）时退回 Canvas2D，
 * 几何用同一组 `LiquidSegmentPhysics` 输出，不静默丢功能。
 */
export const LIQUID_SEGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTrack;
uniform sampler2D uLabels;
uniform vec2 resolution;
uniform vec2 uInvPx;
uniform float density;
uniform float leftEdge, rightEdge, velocity, wobble, press;
uniform vec3 accent, ink, glow;
uniform vec3 satellite0, satellite1, satellite2;
uniform float slotWidth, lip;
uniform float selectionActive;

out vec4 fragColor;

float boxDistance(vec2 q, vec2 b, float r) {
    vec2 d = abs(q) - b + r;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
float smoothMinimum(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * .25;
}
float satelliteDistance(vec2 p, vec3 s) {
    return s.z < .4 ? 1000.0 : length(p - s.xy) - s.z;
}
float shape(vec2 p) {
    float cx = (leftEdge + rightEdge) * .5;
    float hw = max((rightEdge - leftEdge) * .5, 1.0);
    float dir = clamp(velocity / 1000.0, -1.0, 1.0);
    float hh = (resolution.y - 8.0) * .5 * (1.0 + press * .09) * (1.0 - abs(dir) * .16) * (1.0 - abs(wobble) * .12);
    vec2 q = p - vec2(cx, resolution.y * .5);
    float disturbance = min(abs(velocity) / 1800.0, 1.0) * 5.0 + min(abs(wobble) * 9.0, 4.0);
    float phase = cx * .045;
    q.y += disturbance * sin(q.x * .11 + phase);
    q.x += disturbance * .6 * sin(q.y * .22 + phase * 1.3);
    float qn = clamp(q.x / hw, -1.0, 1.0);
    float tail = clamp(-dir * qn, 0.0, 1.0);
    float h2 = max(1.0, hh * (1.0 + dir * .24 * qn + wobble * .70 * qn) * (1.0 - .50 * abs(dir) * tail * tail));
    q.y -= wobble * 4.0 * qn;
    float d = boxDistance(q, vec2(hw, h2), h2);
    d = smoothMinimum(d, satelliteDistance(p, satellite0), 11.0);
    d = smoothMinimum(d, satelliteDistance(p, satellite1), 11.0);
    return smoothMinimum(d, satelliteDistance(p, satellite2), 9.0);
}
vec3 sampleBackground(vec2 p) {
    float cx = (leftEdge + rightEdge) * .5;
    vec4 trackColor = texture(uTrack, (p * density) * uInvPx);
    vec3 base = vec3(trackColor.rgb);
    float light = max(0.0, 1.0 - length((p - vec2(cx, resolution.y * .6)) / vec2(80.0, 80.0)));
    base = mix(base, glow, selectionActive * light * (.20 + min(abs(velocity) / 1800.0, 1.0) * .25));
    float slotCenter = 4.0 + (floor(clamp((p.x - 4.0) / slotWidth, 0.0, 100.0)) + .5) * slotWidth;
    float proximity = max(0.0, 1.0 - abs(cx - slotCenter) / (slotWidth * .8));
    float tint = selectionActive * proximity * proximity * (3.0 - 2.0 * proximity);
    vec4 labelColor = texture(uLabels, (p * density) * uInvPx);
    float alpha = float(labelColor.a);
    return mix(base, mix(ink, accent, tint), alpha);
}
void main() {
    vec2 pixel = gl_FragCoord.xy;
    vec2 p = pixel / density;
    float cy = resolution.y * .5;
    float dTrack = boxDistance(p - vec2(resolution.x * .5, cy), resolution * .5, cy);
    float mask = 1.0 - smoothstep(-.7, .7, dTrack);
    vec4 b = vec4(sampleBackground(p) * mask, mask);
    float bottomLip = (1.0 - smoothstep(0.0, 1.4, dTrack)) * step(0.0, dTrack) * step(cy, p.y) * lip;
    b += vec4(vec3(bottomLip), bottomLip) * (1.0 - b.a);
    if (selectionActive < .5) { fragColor = b; return; }
    float dir = clamp(velocity / 1000.0, -1.0, 1.0);
    vec2 off = vec2(-dir * 9.0, 7.0 + 3.0 * press);
    float sd = shape(p - off);
    float shadow = (1.0 - smoothstep(-5.0, 9.0 + 4.0 * press + abs(dir) * 5.0, sd)) * (.20 - .04 * press);
    float core = (1.0 - smoothstep(-2.0, 5.0, sd + 9.0)) * .28;
    vec4 base = b * (1.0 - shadow) + vec4(vec3(.22, .09, .05) * shadow, shadow);
    base.rgb += glow * core * .75 * mask;
    base.a = max(base.a, core * .45 * mask);
    float d = shape(p);
    if (d > 1.5) { fragColor = base; return; }
    float e = .75;
    vec2 n = normalize(vec2(shape(p + vec2(e, 0.0)) - shape(p - vec2(e, 0.0)),
                             shape(p + vec2(0.0, e)) - shape(p - vec2(0.0, e))) + .00001);
    float B = (resolution.y - 8.0) * .30;
    float t = clamp(-d / B, 0.0, 1.0);
    float edge = 1.0 - t;
    float z = sqrt(max(1.0 - edge * edge, 0.0));
    vec2 c = vec2((leftEdge + rightEdge) * .5, cy);
    vec2 displacement = (c - p) * .20 + n * (17.0 * edge * edge);
    vec3 col = vec3(sampleBackground(p + displacement * .925).r,
                    sampleBackground(p + displacement).g,
                    sampleBackground(p + displacement * 1.075).b);
    float dropAlpha = mix(.62, 1.0, mask);
    vec4 refracted = vec4(col * dropAlpha, dropAlpha);
    vec3 n3 = normalize(vec3(n * pow(edge, .8) * 1.3, .6 + .6 * z));
    vec3 view = vec3(0.0, 0.0, 1.0);
    float s1 = pow(max(dot(n3, normalize(normalize(vec3(-.5, -.7, .55)) + view)), 0.0), 30.0) * .85;
    float s2 = pow(max(dot(n3, normalize(normalize(vec3(.5, .7, .55)) + view)), 0.0), 22.0) * .30;
    float bottom = smoothstep(.15, 1.0, n.y) * edge * edge * .30;
    float line = (1.0 - smoothstep(0.0, 1.6, -d)) * .20;
    refracted.rgb *= 1.0 - .10 * pow(edge, 3.0);
    refracted.rgb += vec3(1.0, .97, .94) * (s1 + s2 + line) + glow * bottom;
    refracted.a = max(refracted.a, max(refracted.r, max(refracted.g, refracted.b)));
    fragColor = mix(base, refracted, 1.0 - smoothstep(-.8, .8, d));
}
`;
