/**
 * Wallpaper picker modal — thumbnail grid with content-rating / type filters,
 * hide/restore (soft delete), batch mode and custom-upload management.
 *
 * Scene wallpapers show a 「场景」 badge (served as rendered frames / extracted
 * videos rather than live HTML); Application wallpapers are never listed
 * (nothing portable to render).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Store } from "../store.js";
import type { RatingFilter, TypeFilter, Wallpaper } from "../types.js";

const RATING_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "everyone", label: "Everyone" },
  { value: "pg13", label: "PG13" },
  { value: "mature", label: "Mature" },
  { value: "unrated", label: "未分级" },
];
const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "web", label: "网页" },
  { value: "image", label: "图片" },
  { value: "scene", label: "场景" },
];
const PAGE_SIZE = 48;

export function Picker({ store }: { store: Store }) {
  const s = store.settings;
  const [tab, setTab] = useState<"grid" | "hidden">("grid");
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => {
    store.ui.pickerOpen = false;
    store.emit();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => store.filteredWallpapers(), [store, store.inventory, s.hiddenIds, s.ratingFilter, s.typeFilter]);
  const hidden = useMemo(
    () =>
      (store.inventory?.wallpapers || []).filter((w) => s.hiddenIds.includes(w.id) && w.playable),
    [store.inventory, s.hiddenIds],
  );
  const shown = tab === "grid" ? visible.slice(0, (page + 1) * PAGE_SIZE) : hidden;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of RATING_OPTIONS) c[o.value] = 0;
    for (const o of TYPE_OPTIONS) c[o.value] = 0;
    const all = (store.inventory?.wallpapers || []).filter((w) => w.playable);
    for (const w of all) {
      c.all = (c.all || 0) + 1;
      const r = w.contentrating ? String(w.contentrating).toLowerCase() : "unrated";
      if (r === "everyone" || r === "pg13" || r === "mature") c[r] = (c[r] || 0) + 1;
      else c.unrated = (c.unrated || 0) + 1;
      const t =
        w.type === "video" ? "video" : w.type === "web" ? "web" : w.type === "scene" ? "scene" : "image";
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  }, [store.inventory]);

  const onUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploadMsg("上传中…");
    let ok = 0;
    for (const f of Array.from(files)) {
      const r = await store.api.upload(f);
      if (r.ok) ok++;
      else setUploadMsg(`上传失败：${r.error || f.name}`);
    }
    if (ok) {
      setUploadMsg(`已上传 ${ok} 张`);
      await store.loadInventory();
    }
    setTimeout(() => setUploadMsg(null), 3000);
  };

  return (
    <div className="we-picker" role="dialog" aria-modal="true" aria-label="选择壁纸">
      <div className="we-picker__scrim" onClick={close} />
      <div className="we-picker__panel">
        <div className="we-picker__head">
          <div className="we-picker__tabs">
            <button
              className={tab === "grid" ? "we-tab--active" : ""}
              onClick={() => { setTab("grid"); setPage(0); }}
            >
              壁纸库
            </button>
            <button
              className={tab === "hidden" ? "we-tab--active" : ""}
              onClick={() => setTab("hidden")}
            >
              已隐藏 {hidden.length ? `(${hidden.length})` : ""}
            </button>
          </div>
          <div className="we-picker__filters">
            <select
              value={s.ratingFilter}
              onChange={(e) => store.patch({ ratingFilter: e.target.value as RatingFilter, wallpaperId: null })}
            >
              {RATING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({counts[o.value] || 0})
                </option>
              ))}
            </select>
            <select
              value={s.typeFilter}
              onChange={(e) => store.patch({ typeFilter: e.target.value as TypeFilter, wallpaperId: null })}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({counts[o.value] || 0})
                </option>
              ))}
            </select>
          </div>
          <button className="we-iconbtn" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="we-picker__tools">
          <button
            className={batch ? "we-btn--active" : ""}
            onClick={() => { setBatch(!batch); setSelected(new Set()); }}
          >
            {batch ? "退出批量" : "批量"}
          </button>
          {tab === "hidden" && hidden.length > 1 && (
            <button onClick={() => store.patch({ hiddenIds: [] })}>全部恢复</button>
          )}
          <div className="we-picker__spacer" />
          {uploadMsg && <span className="we-picker__msg">{uploadMsg}</span>}
          <button onClick={() => fileRef.current?.click()}>上传壁纸</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,video/mp4"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>

        {shown.length === 0 ? (
          <div className="we-picker__empty">
            {tab === "grid"
              ? store.inventory
                ? "没有符合条件的壁纸。确认 Wallpaper Engine 已安装，或调整筛选条件。"
                : "无法连接壁纸服务（/wallpaper-engine/inventory）。请确认 ZCode 已安装本插件补丁。"
              : "没有已隐藏的壁纸。"}
          </div>
        ) : (
          <div className={s.compact ? "we-grid we-grid--compact" : "we-grid"}>
            {shown.map((w) => (
              <Card
                key={w.id}
                w={w}
                selectedId={s.wallpaperId}
                batch={batch}
                checked={selected.has(w.id)}
                onPick={() => {
                  if (batch) {
                    const next = new Set(selected);
                    next.has(w.id) ? next.delete(w.id) : next.add(w.id);
                    setSelected(next);
                  } else {
                    store.patch({ wallpaperId: w.id, paused: false });
                    close();
                  }
                }}
                onHide={() => store.toggleHidden(w.id, true)}
                onRestore={() => store.toggleHidden(w.id, false)}
              />
            ))}
          </div>
        )}

        {tab === "grid" && shown.length < visible.length && (
          <div className="we-picker__more">
            <button onClick={() => setPage(page + 1)}>
              加载更多（{visible.length - shown.length}）
            </button>
          </div>
        )}

        {batch && selected.size > 0 && (
          <div className="we-picker__batchbar">
            已选 {selected.size} 项
            <button
              onClick={() => {
                for (const id of selected) store.toggleHidden(id, true);
                setSelected(new Set());
                setBatch(false);
              }}
            >
              批量隐藏
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  w,
  selectedId,
  batch,
  checked,
  onPick,
  onHide,
  onRestore,
}: {
  w: Wallpaper;
  selectedId: string | null;
  batch: boolean;
  checked: boolean;
  onPick: () => void;
  onHide: () => void;
  onRestore: () => void;
}) {
  const isSel = w.id === selectedId;
  return (
    <div
      className={`we-card${isSel ? " we-card--selected" : ""}${checked ? " we-card--checked" : ""}`}
      title={w.title}
    >
      <button className="we-card__thumb" onClick={onPick} aria-label={w.title}>
        {w.preview ? (
          <img src={storeMedia(w.preview)} alt="" loading="lazy" />
        ) : (
          <span className="we-card__nothumb">无预览</span>
        )}
        {w.type === "scene" && <span className="we-card__badge">场景</span>}
        {w.type === "web" && <span className="we-card__badge we-card__badge--web">网页</span>}
      </button>
      <div className="we-card__foot">
        <span className="we-card__title">{w.title}</span>
        {onHide && !batch && (
          <button className="we-card__hide" onClick={onHide} title="隐藏（不删除源文件）">
            隐藏
          </button>
        )}
        {onRestore && (
          <button className="we-card__hide" onClick={onRestore} title="恢复到壁纸库">
            恢复
          </button>
        )}
      </div>
    </div>
  );
}

/** Keep the inventory's already-absolute URLs untouched. */
function storeMedia(url: string): string {
  return url.startsWith("http") || url.startsWith("/") ? url : `/wallpaper-engine/${url}`;
}
