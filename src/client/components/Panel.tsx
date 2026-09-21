/**
 * Liquid-glass settings panel — the ZCode workbench has no first-class
 * settings slot for out-of-tree panels, so this is a free-floating panel the
 * launcher toggles. Six control domains, one tab each, mirroring the upstream
 * port's tab IA (壁纸 / 外观 / 字体 / 效果 / 高级).
 */
import { useEffect, useState } from "react";
import type { Store } from "../store.js";
import type { ObjectFit, Settings } from "../types.js";

const TABS = [
  { id: "wallpaper", label: "壁纸" },
  { id: "appearance", label: "外观" },
  { id: "font", label: "字体" },
  { id: "effects", label: "效果" },
  { id: "advanced", label: "高级" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function Panel({ store }: { store: Store }) {
  const s = store.settings;
  const [tab, setTab] = useState<TabId>(store.ui.tab as TabId);
  useEffect(() => {
    store.ui.tab = tab;
  }, [tab, store]);

  return (
    <div className="we-panel" role="dialog" aria-label="Wallpaper Engine 设置">
      <div className="we-panel__head">
        <span className="we-panel__title">Wallpaper Engine</span>
        <div className="we-panel__spacer" />
        <button className="we-iconbtn" onClick={() => store.loadInventory()} title="重新扫描壁纸库">
          ⟳
        </button>
        <button className="we-iconbtn" onClick={() => { store.ui.panelOpen = false; store.emit(); }} aria-label="收起">
          ✕
        </button>
      </div>
      <div className="we-panel__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "we-tab--active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="we-panel__body">
        {tab === "wallpaper" && <WallpaperTab store={store} s={s} />}
        {tab === "appearance" && <AppearanceTab store={store} s={s} />}
        {tab === "font" && <FontTab store={store} s={s} />}
        {tab === "effects" && <EffectsTab store={store} s={s} />}
        {tab === "advanced" && <AdvancedTab store={store} s={s} />}
      </div>
    </div>
  );
}

// ── 壁纸 ─────────────────────────────────────────────────────────────────────

function WallpaperTab({ store, s }: { store: Store; s: Settings }) {
  const w = store.selectedWallpaper();
  return (
    <>
      <div className="we-field">
        <label>当前壁纸</label>
        {w ? (
          <div className="we-now">
            <div className="we-now__thumb">
              {w.preview && <img src={w.preview} alt="" />}
            </div>
            <div className="we-now__meta">
              <strong>{w.title}</strong>
              <span className="we-now__type">
                {w.type === "video" ? "视频" : w.type === "web" ? "网页" : w.type === "scene" ? "场景" : "图片"}
              </span>
            </div>
            <div className="we-now__acts">
              <button
                onClick={() => store.patch({ paused: !s.paused })}
                disabled={w.type !== "video" && !w.sceneVideo}
              >
                {s.paused ? "播放" : "暂停"}
              </button>
              <button onClick={() => store.patch({ wallpaperId: null, paused: false })}>关闭</button>
            </div>
          </div>
        ) : (
          <div className="we-empty">尚未选择壁纸。</div>
        )}
        <button className="we-field__action" onClick={() => { store.ui.pickerOpen = true; store.emit(); }}>
          选择壁纸
        </button>
      </div>

      <div className="we-field">
        <label>自动轮播</label>
        <Toggle
          on={s.rotationEnabled}
          onChange={(v) => {
            store.patch({ rotationEnabled: v });
            if (v && s.rotationGroups.length === 0) {
              seedFromInventory(store);
            }
          }}
        />
        {s.rotationEnabled && (
          <>
            <Row>
              <select
                value={s.rotationGroupId || ""}
                onChange={(e) => store.patch({ rotationGroupId: e.target.value })}
              >
                {s.rotationGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.wallpaperIds.length}）
                  </option>
                ))}
              </select>
            </Row>
            <Row label="切换间隔（秒）">
              <input
                type="number"
                min={5}
                max={86400}
                value={(() => {
                  const g = s.rotationGroups.find((x) => x.id === s.rotationGroupId);
                  return g ? g.intervalSec : 300;
                })()}
                onChange={(e) => {
                  const groups = s.rotationGroups.map((g) =>
                    g.id === s.rotationGroupId ? { ...g, intervalSec: Number(e.target.value) || 300 } : g,
                  );
                  store.patch({ rotationGroups: groups });
                }}
              />
            </Row>
            <Row label="顺序">
              <select
                value={s.rotationGroups.find((g) => g.id === s.rotationGroupId)?.order || "sequence"}
                onChange={(e) => {
                  const order = e.target.value as "sequence" | "random";
                  const groups = s.rotationGroups.map((g) =>
                    g.id === s.rotationGroupId ? { ...g, order } : g,
                  );
                  store.patch({ rotationGroups: groups });
                }}
              >
                <option value="sequence">顺序</option>
                <option value="random">随机</option>
              </select>
            </Row>
          </>
        )}
      </div>

      <div className="we-field">
        <label>自定义壁纸</label>
        <div className="we-note">上传的 JPG / PNG / MP4 存到主机：{store.inventory?.uploadDir || "～/.zcode-wallpaper-engine/uploads"}</div>
        <div className="we-uploads">
          {(store.inventory?.wallpapers || [])
            .filter((x) => x.id.startsWith("up-"))
            .map((x) => (
              <div key={x.id} className="we-upload">
                <span className="we-upload__name">{x.title}</span>
                <button onClick={() => store.api.remove(x.id).then(() => store.loadInventory())}>
                  移除
                </button>
              </div>
            ))}
        </div>
        <button
          className="we-field__action"
          onClick={() => { store.ui.pickerOpen = true; store.ui.tab = "wallpaper"; store.emit(); }}
        >
          管理（在选择弹窗中上传）
        </button>
      </div>
    </>
  );
}

function seedFromInventory(store: Store): void {
  const ids = store
    .filteredWallpapers()
    .slice(0, 12)
    .map((w) => w.id);
  if (ids.length < 2) return;
  const g = { id: `grp-${Date.now()}`, name: "我的轮播", wallpaperIds: ids, intervalSec: 300, order: "sequence" as const };
  store.patch({ rotationGroups: [g], rotationGroupId: g.id });
}

// ── 外观 ─────────────────────────────────────────────────────────────────────

const ACCENT_PRESETS = ["#7c6cff", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];
const GLASS_PRESETS = ["#ffffff", "#e8eef8", "#cfe0ff", "#101828", "#1b2334", "#241a2e"];

function AppearanceTab({ store, s }: { store: Store; s: Settings }) {
  return (
    <>
      <ColorRow
        label="配色（accent）"
        presets={ACCENT_PRESETS}
        value={s.accent}
        onChange={(v) => store.patch({ accent: v })}
      />
      <ColorRow
        label="玻璃颜色"
        presets={GLASS_PRESETS}
        value={s.glassColor}
        onChange={(v) => store.patch({ glassColor: v })}
      />
      <Slider
        label="玻璃透明度"
        min={0}
        max={0.6}
        step={0.01}
        value={s.glassOpacity}
        onChange={(v) => store.patch({ glassOpacity: v })}
        fmt={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="玻璃（模糊半径）"
        min={0}
        max={60}
        step={1}
        value={s.glass}
        onChange={(v) => store.patch({ glass: v })}
        fmt={(v) => `${v}px`}
      />
      <Slider
        label="边框"
        min={0}
        max={1}
        step={0.05}
        value={s.border}
        onChange={(v) => store.patch({ border: v })}
        fmt={(v) => `${Math.round(v * 100)}%`}
      />
    </>
  );
}

// ── 字体 ─────────────────────────────────────────────────────────────────────

const FONT_FAMILIES = ["inherit", "Microsoft YaHei", "KaiTi", "SimSun", "SimHei", "STXingkai", "monospace"];
const CURSOR_PRESETS = ["#ffffff", "#7c6cff", "#ff7a59", "#22d3ee", "#a3e635", "#f472b6"];

function FontTab({ store, s }: { store: Store; s: Settings }) {
  return (
    <>
      <div className="we-field">
        <label>字体自定义</label>
        <Toggle on={s.fontEnabled} onChange={(v) => store.patch({ fontEnabled: v })} />
        {!s.fontEnabled && <div className="we-note">关闭时保持 ZCode 原生外观。</div>}
      </div>
      {s.fontEnabled && (
        <>
          <ColorRow
            label="字体颜色"
            presets={["#e6e9f0", "#c9d1e3", "#8b95ad", "#ffffff", "#1b2334"]}
            value={s.fontColor || "#e6e9f0"}
            onChange={(v) => store.patch({ fontColor: v })}
          />
          <Slider
            label="字重"
            min={100}
            max={900}
            step={100}
            value={s.fontWeight || 400}
            onChange={(v) => store.patch({ fontWeight: v })}
            fmt={(v) => String(v)}
          />
          <Row label="字体族">
            <select
              value={s.fontFamily || "inherit"}
              onChange={(e) => store.patch({ fontFamily: e.target.value })}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f === "inherit" ? undefined : f }}>
                  {f === "inherit" ? "默认" : f}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}
      <ColorRow
        label="输入光标颜色"
        presets={CURSOR_PRESETS}
        value={s.cursorColor || ""}
        allowNone
        onChange={(v) => store.patch({ cursorColor: v || null })}
      />
    </>
  );
}

// ── 效果 ─────────────────────────────────────────────────────────────────────

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FPS_CAPS = [0, 60, 48, 30, 24];
const FITS: ObjectFit[] = ["cover", "contain", "center", "fill"];

function EffectsTab({ store, s }: { store: Store; s: Settings }) {
  return (
    <>
      <Slider label="壁纸模糊" min={0} max={60} step={1} value={s.wallpaperBlur}
        onChange={(v) => store.patch({ wallpaperBlur: v })} fmt={(v) => `${v}px`} />
      <Slider label="亮度" min={0.2} max={2} step={0.05} value={s.brightness}
        onChange={(v) => store.patch({ brightness: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="对比度" min={0.2} max={2} step={0.05} value={s.contrast}
        onChange={(v) => store.patch({ contrast: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="饱和度" min={0} max={2} step={0.05} value={s.saturate}
        onChange={(v) => store.patch({ saturate: v })} fmt={(v) => v.toFixed(2)} />
      <Slider label="壁纸透明度" min={0.1} max={0.9} step={0.05} value={s.wallpaperOpacity}
        onChange={(v) => store.patch({ wallpaperOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="暗化" min={0} max={0.9} step={0.02} value={s.scrim}
        onChange={(v) => store.patch({ scrim: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="玻璃" min={0} max={60} step={1} value={s.glass}
        onChange={(v) => store.patch({ glass: v })} fmt={(v) => `${v}px`} />
      <Row label="倍速">
        <Segmented values={RATES.map(String)} value={String(s.rate)}
          onChange={(v) => store.patch({ rate: Number(v) })} fmt={(v) => `${v}x`} />
      </Row>
      <Row label="帧率上限">
        <Segmented
          values={FPS_CAPS.map(String)}
          value={String(s.fpsCap)}
          onChange={(v) => store.patch({ fpsCap: Number(v) })}
          fmt={(v) => (v === "0" ? "不限" : `${v}`)}
        />
      </Row>
      <Row label="画面适配">
        <Segmented values={FITS} value={s.objectFit} onChange={(v) => store.patch({ objectFit: v as ObjectFit })} />
      </Row>
      <div className="we-field">
        <label>水平翻转</label>
        <Toggle on={s.flip} onChange={(v) => store.patch({ flip: v })} />
      </div>
      <div className="we-field">
        <label>遮挡暂停</label>
        <div className="we-toggles">
          <ToggleRow label="最小化/切页时暂停" on={s.pauseOnHidden}
            onChange={(v) => store.patch({ pauseOnHidden: v })} />
          <ToggleRow label="窗口失焦时暂停" on={s.pauseOnBlur}
            onChange={(v) => store.patch({ pauseOnBlur: v })} />
          <ToggleRow label="使用电池时暂停" on={s.pauseOnBattery}
            onChange={(v) => store.patch({ pauseOnBattery: v })} />
        </div>
      </div>
    </>
  );
}

// ── 高级 ─────────────────────────────────────────────────────────────────────

function AdvancedTab({ store, s }: { store: Store; s: Settings }) {
  const [dir, setDir] = useState(store.inventory?.uploadDir || "");
  return (
    <>
      <div className="we-field">
        <label>紧凑布局</label>
        <Toggle on={s.compact} onChange={(v) => store.patch({ compact: v })} />
        <div className="we-note">开启后选择弹窗使用 CD 架式紧凑网格。</div>
      </div>
      <div className="we-field">
        <label>Edge 兼容渲染</label>
        <Toggle on={s.edgeCompat} onChange={(v) => store.patch({ edgeCompat: v })} />
        <div className="we-note">Edge 会在可见视频上绘制自带工具栏；开启时视频壁纸改用 canvas 渲染规避。</div>
      </div>
      <div className="we-field">
        <label>壁纸库</label>
        <div className="we-note">
          Wallpaper Engine：{store.inventory?.installDir || "未检测到（Steam 库里没有 431960）"}
          <br />
          上传目录：{store.inventory?.uploadDir || "—"}
        </div>
        <Row label="更改上传目录">
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="绝对路径" />
          <button
            onClick={() => {
              if (!dir.trim()) return;
              store.api.setUploadDir(dir.trim(), true).then(() => store.loadInventory());
            }}
          >
            迁移并切换
          </button>
        </Row>
      </div>
    </>
  );
}

// ── controls ──────────────────────────────────────────────────────────────────

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  fmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="we-field we-slider">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="we-slider__value">{fmt ? fmt(value) : value}</span>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={on ? "we-switch we-switch--on" : "we-switch"}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="we-switch__knob" />
    </button>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="we-toggle-row">
      <span>{label}</span>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="we-row">
      {label ? <span className="we-row__label">{label}</span> : <span className="we-row__spacer" />}
      <div className="we-row__ctl">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  values,
  value,
  onChange,
  fmt,
}: {
  values: T[];
  value: T;
  onChange: (v: T) => void;
  fmt?: (v: string) => string;
}) {
  return (
    <div className="we-seg">
      {values.map((v) => (
        <button
          key={v}
          className={v === value ? "we-seg__item we-seg__item--active" : "we-seg__item"}
          onClick={() => onChange(v)}
        >
          {fmt ? fmt(v) : v}
        </button>
      ))}
    </div>
  );
}

function ColorRow({
  label,
  presets,
  value,
  onChange,
  allowNone,
}: {
  label: string;
  presets: string[];
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="we-field">
      <label>{label}</label>
      <div className="we-swatches">
        {allowNone && (
          <button
            className={value ? "we-swatch we-swatch--none" : "we-swatch we-swatch--none we-swatch--active"}
            onClick={() => onChange("")}
            title="自动"
          >
            自动
          </button>
        )}
        {presets.map((c) => (
          <button
            key={c}
            className={c.toLowerCase() === value.toLowerCase() ? "we-swatch we-swatch--active" : "we-swatch"}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
          />
        ))}
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          title="自定义"
        />
      </div>
    </div>
  );
}
