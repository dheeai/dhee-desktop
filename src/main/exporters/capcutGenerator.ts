/**
 * CapCut Project Generator
 *
 * Generates a fully-valid CapCut project folder that can be directly
 * imported into CapCut without manual intervention.
 *
 * CapCut project structure:
 *   - draft_info.json               -- Full timeline content (tracks, materials, canvas)
 *   - draft_meta_info.json          -- Project metadata (paths, IDs, timestamps)
 *   - draft_settings                -- INI-style creation/edit timestamps
 *   - draft_agency_config.json      -- Agency mode config
 *   - attachment_editing.json       -- Edit state tracking
 *   - performance_opt_info.json     -- Precombine segment optimization
 *   - timeline_layout.json          -- Timeline dock layout
 *   - template.tmp / template-2.tmp -- Template cache files
 *   - common_attachment/            -- 3 JSON files
 *   - Resources/                    -- audioAlg, digitalHuman, videoAlg
 *   - adjust_mask/ matting/ qr_upload/ smart_crop/
 *   - media/                        -- Copied media files
 *
 * Timing uses microseconds (1 second = 1,000,000 microseconds).
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const execFileAsync = promisify(execFile);

// ── Shared export types (canonical source) ────────────────────────────────

export interface ExportTimelineItem {
  type: 'image' | 'video' | 'placeholder';
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  sourceOffsetSeconds?: number;
  label?: string;
}

export interface ExportOverlayItem {
  path: string;
  duration: number;
  startTime: number;
  endTime: number;
  label?: string;
}

export interface ExportTextOverlayWord {
  text: string;
  startTime: number;
  endTime: number;
  charStart: number;
  charEnd: number;
}

export interface ExportTextOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: ExportTextOverlayWord[];
}

export interface ExportPromptOverlayCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const MICRO = 1_000_000;
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const CAPCUT_VERSION = '159.0.0';
const CAPCUT_APP_VERSION = '8.1.1';
const CAPCUT_APP_ID = 359289;
const SCHEMA_VERSION = 360000;
const WATERMARK_TEXT = 'dhee';
const WATERMARK_RENDER_INDEX = 13000;

interface TextPresentation {
  alignment?: number;
  alpha?: number;
  bold?: boolean;
  lineMaxWidth?: number;
  size?: number;
  transform?: { x: number; y: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID().toUpperCase();
}

function toMicro(seconds: number): number {
  return Math.round(seconds * MICRO);
}

function nowMicro(): number {
  return Date.now() * 1000;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cleanPath(filePath: string): string {
  if (!filePath.startsWith('file://')) {
    return filePath;
  }

  const decodePath = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  // Remove protocol while preserving leading slash for Unix absolute paths.
  let cleaned = filePath.replace(/^file:\/\//i, '');

  if (cleaned.startsWith('localhost/')) {
    cleaned = cleaned.slice('localhost'.length);
  }

  const queryIndex = cleaned.indexOf('?');
  const hashIndex = cleaned.indexOf('#');
  const cutIndexCandidates = [queryIndex, hashIndex].filter((i) => i >= 0);
  if (cutIndexCandidates.length > 0) {
    cleaned = cleaned.slice(0, Math.min(...cutIndexCandidates));
  }

  cleaned = decodePath(cleaned);

  if (!cleaned.startsWith('/') && !/^[A-Za-z]:/.test(cleaned)) {
    cleaned = `//${cleaned}`;
  }

  if (/^\/[A-Za-z]:/.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
}

// ── CapCut projects directory ─────────────────────────────────────────────

function getCapcutProjectsDir(): string {
  const home = os.homedir();

  if (process.platform === 'win32') {
    // Windows: %LocalAppData%\CapCut\User Data\Projects\com.lveditor.draft
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
  }

  // macOS: ~/Movies/CapCut/User Data/Projects/com.lveditor.draft
  return path.join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
}

// ── Platform identifier reader ────────────────────────────────────────────

interface PlatformInfo {
  app_id: number;
  app_source: string;
  app_version: string;
  device_id: string;
  hard_disk_id: string;
  mac_address: string;
  os: string;
  os_version: string;
}

function currentOs(): string {
  return process.platform === 'win32' ? 'windows' : 'mac';
}

const DEFAULT_PLATFORM: PlatformInfo = {
  app_id: CAPCUT_APP_ID,
  app_source: 'cc',
  app_version: CAPCUT_APP_VERSION,
  device_id: '',
  hard_disk_id: '',
  mac_address: '',
  os: currentOs(),
  os_version: '',
};

async function readPlatformFromCapcut(): Promise<PlatformInfo> {
  const projectsDir = getCapcutProjectsDir();
  try {
    // Try reading root_meta_info.json to find an existing project
    const registryPath = path.join(projectsDir, 'root_meta_info.json');
    const raw = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(raw);
    const drafts = registry.all_draft_store;
    if (Array.isArray(drafts) && drafts.length > 0) {
      // Try to read template-2.tmp from the first project for platform info
      for (const draft of drafts) {
        if (!draft.draft_fold_path) continue;
        try {
          const t2path = path.join(draft.draft_fold_path, 'template-2.tmp');
          const t2raw = await fs.readFile(t2path, 'utf-8');
          const t2 = JSON.parse(t2raw);
          if (t2.platform && t2.platform.device_id) {
            return {
              app_id: t2.platform.app_id || CAPCUT_APP_ID,
              app_source: t2.platform.app_source || 'cc',
              app_version: t2.platform.app_version || CAPCUT_APP_VERSION,
              device_id: t2.platform.device_id || '',
              hard_disk_id: t2.platform.hard_disk_id || '',
              mac_address: t2.platform.mac_address || '',
              os: t2.platform.os || currentOs(),
              os_version: t2.platform.os_version || '',
            };
          }
          // Also try last_modified_platform
          if (t2.last_modified_platform && t2.last_modified_platform.device_id) {
            return {
              app_id: t2.last_modified_platform.app_id || CAPCUT_APP_ID,
              app_source: t2.last_modified_platform.app_source || 'cc',
              app_version: t2.last_modified_platform.app_version || CAPCUT_APP_VERSION,
              device_id: t2.last_modified_platform.device_id || '',
              hard_disk_id: t2.last_modified_platform.hard_disk_id || '',
              mac_address: t2.last_modified_platform.mac_address || '',
              os: t2.last_modified_platform.os || currentOs(),
              os_version: t2.last_modified_platform.os_version || '',
            };
          }
        } catch {
          // Try next project
        }
      }
    }
  } catch {
    // Registry not found or unreadable
  }
  return DEFAULT_PLATFORM;
}

// ── Material types ────────────────────────────────────────────────────────

interface MaterialEntry {
  id: string;
  type: 'video' | 'photo' | 'audio';
  originalPath: string;
  copiedPath: string; // path after copying into project media/
  duration: number; // microseconds
  width: number;
  height: number;
}

interface TrackSegment {
  id: string;
  material_id: string;
  target_timerange: { start: number; duration: number };
  source_timerange: { start: number; duration: number };
}

interface TextSegment {
  id: string;
  material_id: string;
  target_timerange: { start: number; duration: number };
  content: string;
  presentation?: TextPresentation;
}

// ── Media file copier ─────────────────────────────────────────────────────

/**
 * Convert a WebM file to MP4 (H.264) for better CapCut compatibility.
 * CapCut on macOS may not render VP9 WebM files properly in the timeline.
 */
async function convertWebmToMp4(
  srcPath: string,
  destPath: string,
): Promise<void> {
  const ffmpegPath = ffmpegInstaller.path;
  console.log(`[CapCut] Converting WebM to MP4: ${path.basename(srcPath)}`);
  await execFileAsync(ffmpegPath, [
    '-i', srcPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    destPath,
  ]);
  console.log(`[CapCut] Converted: ${path.basename(destPath)}`);
}

async function copyMediaFile(
  srcPath: string,
  projectDir: string,
): Promise<string> {
  const basename = path.basename(srcPath);
  const ext = path.extname(srcPath).toLowerCase();

  // Determine subdirectory based on file type
  let subdir: string;
  if (['.mp4', '.mov', '.m4v', '.mkv', '.webm'].includes(ext)) {
    subdir = 'video';
  } else if (['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'].includes(ext)) {
    subdir = 'audio';
  } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'].includes(ext)) {
    subdir = 'image';
  } else {
    subdir = 'other';
  }

  const destDir = path.join(projectDir, 'media', subdir);
  await fs.mkdir(destDir, { recursive: true });

  // Convert WebM to MP4 for better CapCut compatibility
  if (ext === '.webm') {
    const mp4Basename = basename.replace(/\.webm$/i, '.mp4');
    const destPath = path.join(destDir, mp4Basename);
    try {
      await convertWebmToMp4(srcPath, destPath);
      return destPath;
    } catch (err) {
      console.warn(`[CapCut] WebM conversion failed, copying as-is:`, err);
      // Fall back to direct copy if conversion fails
      const fallbackDest = path.join(destDir, basename);
      try {
        await fs.copyFile(srcPath, fallbackDest);
        return fallbackDest;
      } catch (copyErr) {
        console.warn(`[CapCut] Copy also failed:`, copyErr);
        return srcPath;
      }
    }
  }

  const destPath = path.join(destDir, basename);
  try {
    await fs.copyFile(srcPath, destPath);
  } catch (err) {
    console.warn(`[CapCut] Failed to copy ${srcPath} -> ${destPath}:`, err);
    return srcPath;
  }

  return destPath;
}

// ── Supporting file generators ────────────────────────────────────────────

function buildDraftMetaInfo(
  projectId: string,
  projectDir: string,
  projectsRoot: string,
  projectName: string,
  draftInfoSize: number,
  totalDurationMicro: number,
  platform: PlatformInfo,
): Record<string, unknown> {
  const now = nowMicro();
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_fold_path: projectDir,
    draft_id: projectId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: projectName,
    draft_need_rename_folder: false,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: projectsRoot,
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: draftInfoSize,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_draft_removed: 0,
    tm_duration: totalDurationMicro,
  };
}

function buildDraftSettings(): string {
  const createTime = nowSeconds();
  return [
    '[General]',
    'cloud_last_modify_platform=mac',
    `draft_create_time=${createTime}`,
    `draft_last_edit_time=${createTime}`,
    'real_edit_keys=1',
    'real_edit_seconds=60',
    '',
  ].join('\n');
}

function buildDraftAgencyConfig(): Record<string, unknown> {
  return {
    is_auto_agency_enabled: false,
    is_auto_agency_popup: false,
    is_single_agency_mode: false,
    marterials: null,
    use_converter: false,
    video_resolution: 720,
  };
}

function buildAttachmentEditing(): Record<string, unknown> {
  return {
    editing_draft: {
      ai_remove_filter_words: { enter_source: '', right_id: '' },
      ai_shorts_info: { report_params: '', type: 0 },
      crop_info_extra: { crop_mirror_type: 0, crop_rotate: 0.0, crop_rotate_total: 0.0 },
      digital_human_template_to_video_info: { has_upload_material: false, template_type: 0 },
      draft_used_recommend_function: '',
      edit_type: 0,
      eye_correct_enabled_multi_face_time: 0,
      has_adjusted_render_layer: false,
      image_ai_chat_info: {
        before_chat_edit: false, draft_modify_time: 0, message_id: '',
        model_name: '', prompt_from: '', need_restore: false,
        picture_id: '', sugs_info: [],
      },
      is_open_expand_player: false,
      is_template_text_ai_generate: false,
      is_use_adjust: false,
      is_use_ai_expand: false,
      is_use_ai_remove: false,
      is_use_audio_separation: false,
      is_use_chroma_key: false,
      is_use_curve_speed: false,
      is_use_digital_human: false,
      is_use_edit_multi_camera: false,
      is_use_lip_sync: false,
      is_use_lock_object: false,
      is_use_loudness_unify: false,
      is_use_noise_reduction: false,
      is_use_one_click_beauty: false,
      is_use_one_click_ultra_hd: false,
      is_use_retouch_face: false,
      is_use_smart_adjust_color: false,
      is_use_smart_body_beautify: false,
      is_use_smart_motion: false,
      is_use_subtitle_recognition: false,
      is_use_text_to_audio: false,
      material_edit_session: { material_edit_info: [], session_id: '', session_time: 0 },
      paste_segment_list: [],
      profile_entrance_type: '',
      publish_enter_from: '',
      publish_type: '',
      single_function_type: 0,
      text_convert_case_types: [],
      version: '1.0.0',
      video_recording_create_draft: '',
    },
  };
}

function buildPerformanceOptInfo(): Record<string, unknown> {
  return {
    manual_cancle_precombine_segs: null,
    need_auto_precombine_segs: null,
  };
}

function buildTimelineLayout(projectId: string): Record<string, unknown> {
  return {
    dockItems: [{
      dockIndex: 0,
      ratio: 1,
      timelineIds: [projectId],
      timelineNames: [projectId],
    }],
    layoutOrientation: 1,
  };
}

function buildFunctionAssistantInfo(): Record<string, unknown> {
  return {
    audio_noise_segid_list: [],
    auto_adjust: false,
    auto_adjust_fixed: false,
    auto_adjust_fixed_value: 50.0,
    auto_adjust_segid_list: [],
    auto_caption: false,
    auto_caption_segid_list: [],
    auto_caption_template_id: '',
    caption_opt: false,
    caption_opt_segid_list: [],
    color_correction: false,
    color_correction_fixed: false,
    color_correction_fixed_value: 50.0,
    color_correction_segid_list: [],
    deflicker_segid_list: [],
    enhance_quality: false,
    enhance_quality_fixed: false,
    enhance_quality_segid_list: [],
    enhance_voice_segid_list: [],
    enhande_voice: false,
    enhande_voice_fixed: false,
    eye_correction: false,
    eye_correction_segid_list: [],
    fixed_rec_applied: false,
    fps: { den: 1, num: 0 },
    normalize_loudness: false,
    normalize_loudness_audio_denoise_segid_list: [],
    normalize_loudness_fixed: false,
    normalize_loudness_segid_list: [],
    retouch: false,
    retouch_fixed: false,
    retouch_segid_list: [],
    smart_rec_applied: false,
    smart_segid_list: [],
    smooth_slow_motion: false,
    smooth_slow_motion_fixed: false,
    video_noise_segid_list: [],
  };
}

function buildTemplateTmp(projectId: string): Record<string, unknown> {
  return {
    canvas_config: { background: null, height: 0, ratio: 'original', width: 0 },
    color_space: -1,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1,
      export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '',
      lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true,
      material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none',
      original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true,
      subtitle_taskinfo: [], system_font_list: [], use_float_render: false,
      video_mute: false, zoom_info_params: null,
    },
    cover: null, create_time: 0, draft_type: 'video', duration: 0, extra_info: null,
    fps: FPS * 1.0, free_render_index_mode_on: false,
    function_assistant_info: buildFunctionAssistantInfo(),
    group_container: null, id: projectId, is_drop_frame_timecode: false,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    lyrics_effects: [],
    materials: buildEmptyMaterials(),
    mutable_config: null, name: '', new_version: '75.0.0', path: '',
    platform: { app_id: 0, app_source: '', app_version: '', device_id: '', hard_disk_id: '', mac_address: '', os: '', os_version: '' },
    relationships: [], render_index_track_mode_on: false, retouch_cover: null,
    smart_ads_info: { draft_url: '', page_from: '', routine: '' },
    source: 'default', static_cover_image_path: '', time_marks: null, tracks: [],
    uneven_animation_template_info: { composition: '', content: '', order: '', sub_template_info_list: [] },
    update_time: 0, version: SCHEMA_VERSION,
  };
}

function buildTemplate2Tmp(projectId: string, platform: PlatformInfo): Record<string, unknown> {
  return {
    canvas_config: { background: null, height: HEIGHT, ratio: 'original', width: WIDTH },
    color_space: -1,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1,
      export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '',
      lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true,
      material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none',
      original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true,
      subtitle_taskinfo: [], system_font_list: [], use_float_render: false,
      video_mute: false, zoom_info_params: null,
    },
    cover: null, create_time: 0, draft_type: 'video', duration: 0, extra_info: null,
    fps: FPS * 1.0, free_render_index_mode_on: false,
    function_assistant_info: buildFunctionAssistantInfo(),
    group_container: null, id: projectId, is_drop_frame_timecode: false,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: { ...platform },
    lyrics_effects: [],
    materials: buildEmptyMaterials(),
    mutable_config: null, name: '', new_version: CAPCUT_VERSION, path: '',
    platform: { ...platform },
    relationships: [], render_index_track_mode_on: false, retouch_cover: null,
    smart_ads_info: { draft_url: '', page_from: '', routine: '' },
    source: 'default', static_cover_image_path: '', time_marks: null, tracks: [],
    uneven_animation_template_info: { composition: '', content: '', order: '', sub_template_info_list: [] },
    update_time: 0, version: SCHEMA_VERSION,
  };
}

function buildEmptyMaterials(): Record<string, unknown> {
  return {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audio_pannings: [],
    audio_pitch_shifts: [],
    audio_track_indexes: [],
    audios: [],
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    common_mask: [],
    digital_human_model_dressing: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    hsl_curves: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_beautys: [],
    manual_deformations: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholder_infos: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    smart_relights: [],
    sound_channel_mappings: [],
    speeds: [],
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: [],
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_radius: [],
    video_shadows: [],
    video_strokes: [],
    video_trackings: [],
    videos: [],
    vocal_beautifys: [],
    vocal_separations: [],
  };
}

// ── Speed material helper ─────────────────────────────────────────────────

interface SpeedMaterial {
  id: string;
  speed: number;
}

function createSpeedMaterial(speed = 1.0): SpeedMaterial {
  return { id: uid(), speed };
}

// ── Segment builder helpers ───────────────────────────────────────────────

function buildMediaSegmentObject(
  seg: TrackSegment,
  renderIndex: number,
  isPlaceholder: boolean,
  speedMat: SpeedMaterial,
): Record<string, unknown> {
  return {
    caption_info: null,
    cartoon: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    common_keyframes: [],
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    extra_material_refs: [speedMat.id],
    group_id: '',
    hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    id: seg.id,
    intensifies_audio: false,
    is_placeholder: isPlaceholder,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_volume: 1.0,
    material_id: seg.material_id,
    render_index: renderIndex,
    responsive_layout: {
      enable: false, horizontal_pos_layout: 0, size_layout: 0,
      target_follow: '', vertical_pos_layout: 0,
    },
    reverse: false,
    source_timerange: seg.source_timerange,
    speed: speedMat.speed,
    target_timerange: seg.target_timerange,
    template_id: '',
    template_scene: 'default',
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1.0 },
    visible: true,
    volume: 1.0,
  };
}

function buildTextSegmentObject(
  seg: TextSegment,
  renderIndex: number,
  speedMat: SpeedMaterial,
): Record<string, unknown> {
  const transform = seg.presentation?.transform ?? { x: 0.0, y: -0.8 };

  return {
    caption_info: null,
    cartoon: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform,
    },
    common_keyframes: [],
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    extra_material_refs: [speedMat.id],
    group_id: '',
    id: seg.id,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_volume: 1.0,
    material_id: seg.material_id,
    render_index: renderIndex,
    responsive_layout: {
      enable: false, horizontal_pos_layout: 0, size_layout: 0,
      target_follow: '', vertical_pos_layout: 0,
    },
    reverse: false,
    source_timerange: null,
    speed: speedMat.speed,
    target_timerange: seg.target_timerange,
    template_id: '',
    template_scene: 'default',
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1.0 },
    visible: true,
    volume: 1.0,
  };
}

// ── Registry updater ──────────────────────────────────────────────────────

async function registerInCapcut(
  projectDir: string,
  projectId: string,
  projectName: string,
  draftInfoSize: number,
  totalDurationMicro: number,
): Promise<void> {
  const projectsRoot = getCapcutProjectsDir();
  const registryPath = path.join(projectsRoot, 'root_meta_info.json');
  const now = nowMicro();

  let registry: { all_draft_store: unknown[]; draft_ids: number; root_path: string };
  try {
    const raw = await fs.readFile(registryPath, 'utf-8');
    registry = JSON.parse(raw);
  } catch {
    // If registry doesn't exist, create a new one
    registry = {
      all_draft_store: [],
      draft_ids: 0,
      root_path: projectsRoot,
    };
  }

  const newEntry = {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: path.join(projectDir, 'draft_cover.jpg'),
    draft_fold_path: projectDir,
    draft_id: projectId,
    draft_is_ai_shorts: false,
    draft_is_cloud_temp_draft: false,
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_json_file: path.join(projectDir, 'draft_info.json'),
    draft_name: projectName,
    draft_new_version: '',
    draft_root_path: projectsRoot,
    draft_timeline_materials_size: draftInfoSize,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    streaming_edit_draft_ready: true,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_draft_removed: 0,
    tm_duration: totalDurationMicro,
  };

  // Insert at the beginning (most recent first)
  registry.all_draft_store.unshift(newEntry);
  registry.draft_ids = (registry.draft_ids || 0) + 1;

  await fs.writeFile(registryPath, JSON.stringify(registry), 'utf-8');
  console.log('[CapCut] Registered project in root_meta_info.json');
}

// ── Main generator ────────────────────────────────────────────────────────

export async function generateCapcutProject(
  projectName: string,
  timelineItems: ExportTimelineItem[],
  projectDirectory: string,
  audioPath?: string,
  overlayItems?: ExportOverlayItem[],
  textOverlayCues?: ExportTextOverlayCue[],
  promptOverlayCues?: ExportPromptOverlayCue[],
): Promise<{ outputDir: string; projectId: string }> {
  const projectId = uid();
  const projectsRoot = getCapcutProjectsDir();

  // Create project folder inside CapCut's projects directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const displayName = `dhee-${projectName}`;
  const folderName = `${displayName}-${timestamp}`;
  const projectDir = path.join(projectsRoot, folderName);

  console.log('[CapCut] Creating project at:', projectDir);
  await fs.mkdir(projectDir, { recursive: true });

  // Read platform identifiers from existing CapCut installation
  const platform = await readPlatformFromCapcut();
  console.log('[CapCut] Platform info:', {
    device_id: platform.device_id ? '***' : '(empty)',
    app_version: platform.app_version,
  });

  // ── Collect materials & copy media ──────────────────────────────────────
  const materials: MaterialEntry[] = [];
  const materialPathMap = new Map<string, string>(); // originalCleanPath -> materialId

  async function ensureMaterial(
    filePath: string,
    type: 'video' | 'photo' | 'audio',
    duration: number,
  ): Promise<string> {
    const p = cleanPath(filePath);
    if (materialPathMap.has(p)) {
      return materialPathMap.get(p)!;
    }
    const matId = uid();
    materialPathMap.set(p, matId);

    // Copy file into project media/ directory
    const copiedPath = await copyMediaFile(p, projectDir);

    materials.push({
      id: matId,
      type,
      originalPath: p,
      copiedPath,
      duration: toMicro(duration),
      width: type === 'audio' ? 0 : WIDTH,
      height: type === 'audio' ? 0 : HEIGHT,
    });
    return matId;
  }

  // ── Main video track segments ──────────────────────────────────────────
  const videoSegments: TrackSegment[] = [];
  let runningOffsetMicro = 0;

  for (const item of timelineItems) {
    const durationMicro = toMicro(item.duration);

    if (item.type === 'placeholder' || !item.path || item.path.trim() === '') {
      videoSegments.push({
        id: uid(),
        material_id: '',
        target_timerange: { start: runningOffsetMicro, duration: durationMicro },
        source_timerange: { start: 0, duration: durationMicro },
      });
    } else {
      const matType = item.type === 'image' ? 'photo' : 'video';
      const matId = await ensureMaterial(
        item.path,
        matType,
        item.duration + (item.sourceOffsetSeconds ?? 0),
      );
      const srcStart = toMicro(item.sourceOffsetSeconds ?? 0);

      videoSegments.push({
        id: uid(),
        material_id: matId,
        target_timerange: { start: runningOffsetMicro, duration: durationMicro },
        source_timerange: { start: srcStart, duration: durationMicro },
      });
    }

    runningOffsetMicro += durationMicro;
  }

  const totalDurationMicro = runningOffsetMicro;

  // ── Overlay track segments ─────────────────────────────────────────────
  const overlaySegments: TrackSegment[] = [];

  if (overlayItems && overlayItems.length > 0) {
    console.log(`[CapCut] Processing ${overlayItems.length} overlay item(s)...`);
    for (const overlay of overlayItems) {
      if (!overlay.path || overlay.path.trim() === '') {
        console.warn('[CapCut] Skipping overlay with empty path:', overlay.label);
        continue;
      }
      console.log(`[CapCut] Overlay: ${overlay.label || 'unnamed'} | ${overlay.startTime}s-${overlay.startTime + overlay.duration}s (${overlay.duration}s) | ${path.basename(overlay.path)}`);
      const matId = await ensureMaterial(overlay.path, 'video', overlay.duration);
      overlaySegments.push({
        id: uid(),
        material_id: matId,
        target_timerange: {
          start: toMicro(overlay.startTime),
          duration: toMicro(overlay.duration),
        },
        source_timerange: { start: 0, duration: toMicro(overlay.duration) },
      });
    }
    console.log(`[CapCut] Created ${overlaySegments.length} overlay segment(s)`);
  } else {
    console.log('[CapCut] No overlay items provided');
  }

  // ── Audio track segments ───────────────────────────────────────────────
  const audioSegments: TrackSegment[] = [];

  if (audioPath && audioPath.trim() !== '') {
    const matId = await ensureMaterial(audioPath, 'audio', totalDurationMicro / MICRO);
    audioSegments.push({
      id: uid(),
      material_id: matId,
      target_timerange: { start: 0, duration: totalDurationMicro },
      source_timerange: { start: 0, duration: totalDurationMicro },
    });
  }

  // ── Text track segments ────────────────────────────────────────────────
  const textSegments: TextSegment[] = [];
  const promptTextSegments: TextSegment[] = [];
  const watermarkTextSegments: TextSegment[] = [];

  if (totalDurationMicro > 0) {
    watermarkTextSegments.push({
      id: uid(),
      material_id: uid(),
      target_timerange: {
        start: 0,
        duration: totalDurationMicro,
      },
      content: WATERMARK_TEXT,
      presentation: {
        alignment: 2,
        alpha: 0.46,
        lineMaxWidth: 0.24,
        size: 6.0,
        transform: { x: 0.8, y: 0.9 },
      },
    });
  }

  if (textOverlayCues && textOverlayCues.length > 0) {
    for (const cue of textOverlayCues) {
      const text = cue.text.replace(/\s+/g, ' ').trim();
      if (!text || cue.endTime <= cue.startTime) continue;
      textSegments.push({
        id: uid(),
        material_id: uid(),
        target_timerange: {
          start: toMicro(cue.startTime),
          duration: toMicro(cue.endTime - cue.startTime),
        },
        content: text,
      });
    }
  }

  if (promptOverlayCues && promptOverlayCues.length > 0) {
    for (const cue of promptOverlayCues) {
      const text = cue.text.replace(/\s+/g, ' ').trim();
      if (!text || cue.endTime <= cue.startTime) continue;
      promptTextSegments.push({
        id: uid(),
        material_id: uid(),
        target_timerange: {
          start: toMicro(cue.startTime),
          duration: toMicro(cue.endTime - cue.startTime),
        },
        content: text,
      });
    }
  }

  // ── Build tracks array & collect speed materials ──────────────────────
  const tracks: unknown[] = [];
  const speedMaterials: SpeedMaterial[] = [];

  // Main video track (render_index = 0)
  tracks.push({
    attribute: 0,
    flag: 0,
    id: uid(),
    is_default_name: true,
    name: '',
    segments: videoSegments.map((seg) => {
      const spd = createSpeedMaterial();
      speedMaterials.push(spd);
      return buildMediaSegmentObject(seg, 0, !seg.material_id, spd);
    }),
    type: 'video',
  });

  // Overlay track (render_index = 1, above main track)
  if (overlaySegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: true,
      name: '',
      segments: overlaySegments.map((seg) => {
        const spd = createSpeedMaterial();
        speedMaterials.push(spd);
        return buildMediaSegmentObject(seg, 1, false, spd);
      }),
      type: 'video',
    });
  }

  // Audio track (render_index = 0)
  if (audioSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: true,
      name: '',
      segments: audioSegments.map((seg) => {
        const spd = createSpeedMaterial();
        speedMaterials.push(spd);
        return buildMediaSegmentObject(seg, 0, false, spd);
      }),
      type: 'audio',
    });
  }

  // Watermark text track (render_index = 13000, below prompt/caption tracks)
  if (watermarkTextSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: true,
      name: '',
      segments: watermarkTextSegments.map((seg) => {
        const spd = createSpeedMaterial();
        speedMaterials.push(spd);
        return buildTextSegmentObject(seg, WATERMARK_RENDER_INDEX, spd);
      }),
      type: 'text',
    });
  }

  // Prompt text track (render_index = 14000, above video/overlay tracks)
  if (promptTextSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: true,
      name: '',
      segments: promptTextSegments.map((seg) => {
        const spd = createSpeedMaterial();
        speedMaterials.push(spd);
        return buildTextSegmentObject(seg, 14000, spd);
      }),
      type: 'text',
    });
  }

  // Caption text track (render_index = 15000, above prompt track)
  if (textSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: true,
      name: '',
      segments: textSegments.map((seg) => {
        const spd = createSpeedMaterial();
        speedMaterials.push(spd);
        return buildTextSegmentObject(seg, 15000, spd);
      }),
      type: 'text',
    });
  }

  // ── Build materials section (using copied paths) ───────────────────────

  const videoMaterials = materials
    .filter((m) => m.type === 'video')
    .map((m) => ({
      audio_fade: null,
      category_id: '',
      category_name: 'local',
      check_flag: 1,
      crop: {
        lower_left_x: 0.0, lower_left_y: 1.0,
        lower_right_x: 1.0, lower_right_y: 1.0,
        upper_left_x: 0.0, upper_left_y: 0.0,
        upper_right_x: 1.0, upper_right_y: 0.0,
      },
      duration: m.duration,
      extra_type_option: 0,
      formula_id: '',
      freeze: null,
      has_audio: true,
      height: m.height,
      id: m.id,
      intensifies_audio_path: '',
      intensifies_path: '',
      is_unified_beauty_mode: false,
      local_id: '',
      local_material_id: m.id,
      material_id: m.id,
      material_name: path.basename(m.copiedPath),
      material_url: '',
      matting: {
        flag: 0, has_use_quick_brush: false, has_use_quick_eraser: false,
        interactiveTime: [], path: '', strokes: [],
      },
      media_path: '',
      object_locked: null,
      origin_material_id: m.id,
      path: m.copiedPath,
      request_id: '',
      reverse_intensifies_path: '',
      reverse_path: '',
      smart_motion: null,
      source_platform: 0,
      stable: null,
      team_id: '',
      type: 'video',
      video_algorithm: {
        algorithms: [], deflicker: null, motion_blur_config: null,
        noise_reduction: null, path: '', quality_enhance: null, time_range: null,
      },
      width: m.width,
    }));

  const PHOTO_DEFAULT_DURATION = 10800000000; // 3 hours in microseconds

  const photoMaterials = materials
    .filter((m) => m.type === 'photo')
    .map((m) => ({
      audio_fade: null,
      category_id: '',
      category_name: 'local',
      check_flag: 63487,
      crop: {
        lower_left_x: 0.0, lower_left_y: 1.0,
        lower_right_x: 1.0, lower_right_y: 1.0,
        upper_left_x: 0.0, upper_left_y: 0.0,
        upper_right_x: 1.0, upper_right_y: 0.0,
      },
      crop_ratio: 'free',
      crop_scale: 1.0,
      duration: PHOTO_DEFAULT_DURATION,
      height: m.height,
      id: m.id,
      local_material_id: '',
      material_id: m.id,
      material_name: path.basename(m.copiedPath),
      media_path: '',
      path: m.copiedPath,
      type: 'photo',
      width: m.width,
    }));

  const audioMaterials = materials
    .filter((m) => m.type === 'audio')
    .map((m) => ({
      app_id: 0,
      category_id: '',
      category_name: 'local',
      check_flag: 1,
      duration: m.duration,
      effect_id: '',
      formula_id: '',
      id: m.id,
      intensifies_path: '',
      local_material_id: m.id,
      material_id: m.id,
      material_name: path.basename(m.copiedPath),
      material_url: '',
      media_path: '',
      music_id: '',
      origin_material_id: m.id,
      path: m.copiedPath,
      request_id: '',
      resource_id: '',
      reverse_intensifies_path: '',
      reverse_path: '',
      search_id: '',
      source_platform: 0,
      team_id: '',
      type: 'extract_music',
      video_algorithm: { path: '' },
    }));

  // ── Build text materials ─────────────────────────────────────────────
  const textMaterials = [
    ...watermarkTextSegments,
    ...promptTextSegments,
    ...textSegments,
  ].map((seg) => {
    const alignment = seg.presentation?.alignment ?? 1;
    const alpha = seg.presentation?.alpha ?? 1.0;
    const bold = seg.presentation?.bold ?? false;
    const lineMaxWidth = seg.presentation?.lineMaxWidth ?? 0.82;
    const size = seg.presentation?.size ?? 8.0;

    return {
      id: seg.material_id,
      content: JSON.stringify({
        styles: [{
          fill: {
            alpha,
            content: {
              render_type: 'solid',
              solid: { alpha, color: [1.0, 1.0, 1.0] },
            },
          },
          range: [0, seg.content.length],
          size,
          bold,
          italic: false,
          underline: false,
          strokes: [],
        }],
        text: seg.content,
      }),
      alignment,
      check_flag: 7,
      force_apply_line_max_width: false,
      global_alpha: alpha,
      letter_spacing: 0,
      line_feed: 1,
      line_max_width: lineMaxWidth,
      line_spacing: 0.02,
      type: 'text',
      typesetting: 0,
    };
  });

  // ── Compose draft_info.json (the main content file) ────────────────────

  const materialsSection = buildEmptyMaterials();
  // Photos go into videos array with type:"photo" (CapCut treats them as video materials)
  (materialsSection as Record<string, unknown[]>).videos = [
    ...videoMaterials,
    ...photoMaterials,
  ];
  (materialsSection as Record<string, unknown[]>).audios = audioMaterials;
  (materialsSection as Record<string, unknown[]>).texts = textMaterials;
  (materialsSection as Record<string, unknown[]>).speeds = speedMaterials.map(
    (s) => ({
      curve_speed: null,
      id: s.id,
      mode: 0,
      speed: s.speed,
      type: 'speed',
    }),
  );

  const draftInfo: Record<string, unknown> = {
    canvas_config: {
      background: null,
      height: HEIGHT,
      ratio: 'original',
      width: WIDTH,
    },
    color_space: -1,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      use_float_render: false,
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    draft_type: 'video',
    duration: totalDurationMicro,
    extra_info: null,
    fps: FPS * 1.0,
    free_render_index_mode_on: false,
    function_assistant_info: buildFunctionAssistantInfo(),
    group_container: null,
    id: projectId,
    is_drop_frame_timecode: false,
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [], audios: [], effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: [],
    },
    last_modified_platform: { ...platform },
    lyrics_effects: [],
    materials: materialsSection,
    mutable_config: null,
    name: '',
    new_version: CAPCUT_VERSION,
    path: '',
    platform: { ...platform },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    smart_ads_info: { draft_url: '', page_from: '', routine: '' },
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks,
    uneven_animation_template_info: {
      composition: '', content: '', order: '', sub_template_info_list: [],
    },
    update_time: 0,
    version: SCHEMA_VERSION,
  };

  // ── Write all files ────────────────────────────────────────────────────

  // 1. draft_info.json (the main content file)
  const draftInfoJson = JSON.stringify(draftInfo);
  await fs.writeFile(
    path.join(projectDir, 'draft_info.json'),
    draftInfoJson,
    'utf-8',
  );
  const draftInfoSize = Buffer.byteLength(draftInfoJson, 'utf-8');

  // 2. draft_meta_info.json
  await fs.writeFile(
    path.join(projectDir, 'draft_meta_info.json'),
    JSON.stringify(buildDraftMetaInfo(
      projectId, projectDir, projectsRoot, displayName,
      draftInfoSize, totalDurationMicro, platform,
    )),
    'utf-8',
  );

  // 3. draft_settings (INI format)
  await fs.writeFile(
    path.join(projectDir, 'draft_settings'),
    buildDraftSettings(),
    'utf-8',
  );

  // 4. draft_agency_config.json
  await fs.writeFile(
    path.join(projectDir, 'draft_agency_config.json'),
    JSON.stringify(buildDraftAgencyConfig()),
    'utf-8',
  );

  // 5. attachment_editing.json
  await fs.writeFile(
    path.join(projectDir, 'attachment_editing.json'),
    JSON.stringify(buildAttachmentEditing()),
    'utf-8',
  );

  // 6. performance_opt_info.json
  await fs.writeFile(
    path.join(projectDir, 'performance_opt_info.json'),
    JSON.stringify(buildPerformanceOptInfo()),
    'utf-8',
  );

  // 7. timeline_layout.json
  await fs.writeFile(
    path.join(projectDir, 'timeline_layout.json'),
    JSON.stringify(buildTimelineLayout(projectId)),
    'utf-8',
  );

  // 8. template.tmp
  await fs.writeFile(
    path.join(projectDir, 'template.tmp'),
    JSON.stringify(buildTemplateTmp(projectId)),
    'utf-8',
  );

  // 9. template-2.tmp
  await fs.writeFile(
    path.join(projectDir, 'template-2.tmp'),
    JSON.stringify(buildTemplate2Tmp(projectId, platform)),
    'utf-8',
  );

  // 10. common_attachment/ directory with 3 files
  const commonAttachDir = path.join(projectDir, 'common_attachment');
  await fs.mkdir(commonAttachDir, { recursive: true });

  await fs.writeFile(
    path.join(commonAttachDir, 'attachment_action_scene.json'),
    JSON.stringify({ action_scene: { removed_segments: [], segment_infos: [] } }),
    'utf-8',
  );
  await fs.writeFile(
    path.join(commonAttachDir, 'attachment_pc_timeline.json'),
    JSON.stringify({
      reference_lines_config: {
        horizontal_lines: [], is_lock: false, is_visible: false, vertical_lines: [],
      },
      safe_area_type: 0,
    }),
    'utf-8',
  );
  await fs.writeFile(
    path.join(commonAttachDir, 'attachment_script_video.json'),
    JSON.stringify({
      script_video: {
        attachment_valid: false, language: '', overdub_recover: [],
        overdub_sentence_ids: [], parts: [], sync_subtitle: false,
        translate_segments: [], translate_type: '', version: '1.0.0',
      },
    }),
    'utf-8',
  );

  // 11. Create required empty directories
  const emptyDirs = [
    'Resources/audioAlg',
    'Resources/digitalHuman/audio',
    'Resources/digitalHuman/bsinfo',
    'Resources/digitalHuman/video',
    'Resources/videoAlg',
    'adjust_mask',
    'matting',
    'qr_upload',
    'smart_crop',
  ];
  for (const dir of emptyDirs) {
    await fs.mkdir(path.join(projectDir, dir), { recursive: true });
  }

  // ── Register in CapCut's root_meta_info.json ───────────────────────────
  try {
    await registerInCapcut(
      projectDir, projectId, displayName,
      draftInfoSize, totalDurationMicro,
    );
  } catch (err) {
    console.warn('[CapCut] Failed to register project in CapCut registry:', err);
    // Non-fatal: the project folder is still valid
  }

  console.log('[CapCut] Project created successfully at:', projectDir);
  return { outputDir: projectDir, projectId };
}
