/**
 * Placement Parsers Utility
 * Parses image and video placement markdown files for timeline display
 *
 * Improved parser with:
 * - Enhanced regex patterns for whitespace variations
 * - Flexible line-by-line parsing
 * - Comprehensive validation and error reporting
 */

export interface ParsedImagePlacement {
  placementNumber: number;
  startTime: string; // "0:08"
  endTime: string; // "0:24"
  prompt: string;
}

export interface ParsedVideoPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
  prompt: string;
  duration: number; // Calculated from timestamps
  filename?: string; // Optional, for backward compatibility with dhee-core
}

export interface ParseError {
  line: number;
  content: string;
  reason: string;
  suggestion?: string;
}

export interface ParseResult {
  placements: ParsedImagePlacement[];
  errors: ParseError[];
  warnings: string[];
}

/**
 * Convert time string to seconds.
 * Handles formats: "M:SS", "MM:SS", "H:MM:SS", "HH:MM:SS"
 */
function sanitizeTimeToken(timeStr: string): string {
  return timeStr
    .trim()
    .replace(/^[\[\(]+/, '')
    .replace(/[\]\)]+$/, '')
    .replace(/,/g, '.');
}

export function timeStringToSeconds(timeStr: string): number {
  const cleaned = sanitizeTimeToken(timeStr);
  const parts = cleaned.split(':');
  const parseSeconds = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  if (parts.length === 3) {
    // HH:MM:SS[.mmm] format
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    // M:SS[.mmm] or MM:SS[.mmm] format
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[1] ?? '0');
    return minutes * 60 + seconds;
  }
  // If it's just seconds (e.g., "15" or "15.500")
  return parseSeconds(cleaned);
}

/**
 * Normalize time string to standard format (M:SS or MM:SS)
 */
function normalizeTime(timeStr: string): string {
  const cleaned = sanitizeTimeToken(timeStr);
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    // HH:MM:SS -> MM:SS (if hours is 0) or keep as is
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    if (hours === 0) {
      return `${parts[1]}:${parts[2]}`;
    }
    return cleaned;
  }
  return cleaned;
}

/**
 * Parse time range string (e.g., "0:15-0:33" or "00:15-00:33")
 * Returns { startTime, endTime } or null if invalid
 */
function parseTimeRange(
  timeRange: string,
): { startTime: string; endTime: string } | null {
  // More flexible time range matching - handles various formats
  const timeMatch = timeRange.match(/^(\[?[\d:.,]+\]?)\s*-\s*(\[?[\d:.,]+\]?)$/);
  if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
    return null;
  }

  const startTime = normalizeTime(timeMatch[1].trim());
  const endTime = normalizeTime(timeMatch[2].trim());

  // Validate that start < end
  const startSeconds = timeStringToSeconds(startTime);
  const endSeconds = timeStringToSeconds(endTime);
  if (startSeconds >= endSeconds) {
    return null;
  }

  return { startTime, endTime };
}

/**
 * Try multiple regex patterns to match a placement line
 * Returns match groups or null if no pattern matches
 */
function tryMatchPlacementLine(line: string): RegExpMatchArray | null {
  // Pattern 1: Standard format with bullet/dash
  // Handles: - Placement N: time-time | prompt
  // More flexible whitespace handling
  let match = line.match(
    /^[•\-]\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/,
  );
  if (match) return match;

  // Pattern 2: Without leading bullet/dash
  match = line.match(/^Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/);
  if (match) return match;

  // Pattern 3: More flexible - allows extra spaces around colon and pipe
  match = line.match(
    /^[•\-]?\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/,
  );
  if (match) return match;

  return null;
}

/**
 * Parse image placements from the image-placements.md file content.
 *
 * Expected format:
 * - Placement N: startTime-endTime | prompt text
 *
 * Legacy format (filename is optional, for backward compatibility):
 * - Placement N: startTime-endTime | prompt text | filename.png
 *
 * @param content - The content of the image-placements.md file
 * @param strict - If true, return errors for invalid lines. If false, silently skip them (backward compatibility)
 * @returns ParseResult with placements, errors, and warnings
 */
export function parseImagePlacementsWithErrors(
  content: string,
  strict: boolean = false,
): ParseResult {
  const placements: ParsedImagePlacement[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  // Split by lines and process each line
  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]!;
    const trimmedLine = line.trim();

    // Skip empty lines and header lines
    if (
      !trimmedLine ||
      trimmedLine === 'IMAGE_PLACER:' ||
      trimmedLine.startsWith('IMAGE_PLACER:')
    ) {
      continue;
    }

    // Skip lines that don't contain "Placement"
    if (!trimmedLine.includes('Placement')) {
      continue;
    }

    // Try to match the placement line
    const match = tryMatchPlacementLine(trimmedLine);
    if (!match || !match[1] || !match[2] || !match[3]) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Failed to match placement pattern',
          suggestion:
            'Expected format: "- Placement N: startTime-endTime | prompt text"',
        });
      }
      continue;
    }

    const placementNumberStr = match[1]!;
    const timeRange = match[2]!.trim();
    const promptWithOptionalFilename = match[3]!.trim();

    // Parse placement number
    const placementNumber = parseInt(placementNumberStr, 10);
    if (isNaN(placementNumber) || placementNumber < 1) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid placement number: ${placementNumberStr}`,
          suggestion: 'Placement number must be a positive integer',
        });
      }
      continue;
    }

    // Parse time range
    const timeRangeResult = parseTimeRange(timeRange);
    if (!timeRangeResult) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid time range: ${timeRange}`,
          suggestion:
            'Expected format: "startTime-endTime" (e.g., "0:15-0:33"). Start time must be less than end time.',
        });
      }
      continue;
    }

    // Extract prompt (remove optional filename if present)
    // Filename is optional and comes after a second pipe
    let prompt = promptWithOptionalFilename;
    const filenameMatch =
      promptWithOptionalFilename.match(/^(.+?)\s*\|\s*(.+)$/);
    if (filenameMatch && filenameMatch[2]) {
      // Has filename, use first part as prompt
      prompt = filenameMatch[1]!.trim();
      // Filename is ignored (for backward compatibility)
    }

    // Validate prompt is not empty
    if (!prompt || prompt.length === 0) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Prompt is empty',
          suggestion: 'Provide a description for the image placement',
        });
      }
      continue;
    }

    placements.push({
      placementNumber,
      startTime: timeRangeResult.startTime,
      endTime: timeRangeResult.endTime,
      prompt,
    });
  }

  // Validate placements
  const placementNumbers = new Set<number>();
  for (const placement of placements) {
    if (placementNumbers.has(placement.placementNumber)) {
      warnings.push(
        `Duplicate placement number ${placement.placementNumber} found`,
      );
    }
    placementNumbers.add(placement.placementNumber);
  }

  // Check for sequential placement numbers (warning, not error)
  const sortedNumbers = Array.from(placementNumbers).sort((a, b) => a - b);
  for (let i = 0; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] !== i + 1) {
      warnings.push(
        `Placement numbers are not sequential. Expected ${i + 1}, found ${sortedNumbers[i]}`,
      );
      break;
    }
  }

  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);

  return {
    placements,
    errors,
    warnings,
  };
}

/**
 * Parse image placements from the image-placements.md file content.
 *
 * Expected format:
 * - Placement N: startTime-endTime | prompt text
 *
 * Legacy format (filename is optional, for backward compatibility):
 * - Placement N: startTime-endTime | prompt text | filename.png
 *
 * @param content - The content of the image-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseImagePlacements(content: string): ParsedImagePlacement[] {
  const result = parseImagePlacementsWithErrors(content, false);

  // Log warnings and errors for debugging
  if (result.warnings.length > 0) {
    console.warn('[parseImagePlacements] Warnings:', result.warnings);
  }
  if (result.errors.length > 0) {
    console.error(
      '[parseImagePlacements] Errors (non-strict mode, continuing):',
      result.errors,
    );
  }

  return result.placements;
}

/**
 * Round duration to nearest valid value (4-10 seconds).
 * Rounds to the nearest valid duration that matches generation capability.
 * Hard limit of 10 seconds due to hardware constraints.
 */
function roundDuration(seconds: number): number {
  // Round to nearest valid duration (4, 5, 6, 7, 8, 9, or 10)
  if (seconds <= 4.5) return 4;
  if (seconds <= 5.5) return 5;
  if (seconds <= 6.5) return 6;
  if (seconds <= 7.5) return 7;
  if (seconds <= 8.5) return 8;
  if (seconds <= 9.5) return 9;
  if (seconds <= 10.5) return 10;
  return 10; // Cap at 10 seconds (hardware limitation)
}

/**
 * Parse video placements from the video-placements.md file content.
 *
 * Expected format:
 * - Placement N: startTime-endTime | type=video_type | prompt text
 *
 * Legacy format (filename is ignored):
 * - Placement N: startTime-endTime | type=video_type | prompt text | filename.mp4
 *
 * @param content - The content of the video-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseVideoPlacements(content: string): ParsedVideoPlacement[] {
  const placements: ParsedVideoPlacement[] = [];

  // Split by lines and process each line
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    // Skip header (VIDEO_PLACER:) and non-placement lines
    if (!trimmedLine.includes('Placement')) {
      continue;
    }

    // Match pattern: - Placement N: startTime-endTime | type=video_type | prompt [| filename]
    // Also handle: • Placement N: ... (bullet point)
    // Filename is optional (for backward compatibility)
    // More flexible whitespace handling
    const placementMatch = trimmedLine.match(
      /^[•\-]?\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*type\s*=\s*([^\|]+?)\s*\|\s*(.+)$/,
    );

    if (
      !placementMatch ||
      !placementMatch[1] ||
      !placementMatch[2] ||
      !placementMatch[3] ||
      !placementMatch[4]
    ) {
      // Try alternative format without leading dash/bullet
      const altMatch = trimmedLine.match(
        /Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*type\s*=\s*([^\|]+?)\s*\|\s*(.+)$/,
      );
      if (
        !altMatch ||
        !altMatch[1] ||
        !altMatch[2] ||
        !altMatch[3] ||
        !altMatch[4]
      ) {
        continue;
      }

      const placementNumber = parseInt(altMatch[1], 10);
      const timeRange = altMatch[2].trim();
      const videoTypeStr = altMatch[3].trim();
      const promptWithOptionalFilename = altMatch[4].trim();
      const filenameMatch =
        promptWithOptionalFilename.match(/^(.+?)\s*\|\s*(.+)$/);
      const prompt = filenameMatch
        ? filenameMatch[1]!.trim()
        : promptWithOptionalFilename;
      const filename = filenameMatch ? filenameMatch[2]!.trim() : undefined;

      // Parse time range (format: "0:15-0:24" or "7:41-7:56")
      const timeRangeResult = parseTimeRange(timeRange);
      if (!timeRangeResult) {
        continue;
      }

      const { startTime } = timeRangeResult;
      const { endTime } = timeRangeResult;
      const startSeconds = timeStringToSeconds(startTime);
      const endSeconds = timeStringToSeconds(endTime);
      const duration = roundDuration(endSeconds - startSeconds);

      // Normalize video type
      const normalizedType = videoTypeStr.toLowerCase().trim();
      let videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
      if (
        normalizedType === 'cinematic_realism' ||
        normalizedType === 'cinematic-realism' ||
        normalizedType === 'cinematic' ||
        normalizedType === 'animation' ||
        normalizedType === 'anim'
      ) {
        videoType = 'cinematic_realism';
      } else if (
        normalizedType === 'stock_footage' ||
        normalizedType === 'stock'
      ) {
        videoType = 'stock_footage';
      } else if (
        normalizedType === 'motion_graphics' ||
        normalizedType === 'motiongraphics' ||
        normalizedType === 'motion'
      ) {
        videoType = 'motion_graphics';
      } else {
        videoType = 'cinematic_realism';
      }

      placements.push({
        placementNumber,
        startTime,
        endTime,
        videoType,
        prompt,
        duration,
        filename,
      });
      continue;
    }

    const placementNumber = parseInt(placementMatch[1], 10);
    const timeRange = placementMatch[2].trim();
    const videoTypeStr = placementMatch[3].trim();
    const promptWithOptionalFilename = placementMatch[4].trim();
    const filenameMatch =
      promptWithOptionalFilename.match(/^(.+?)\s*\|\s*(.+)$/);
    const prompt = filenameMatch
      ? filenameMatch[1]!.trim()
      : promptWithOptionalFilename;
    const filename = filenameMatch ? filenameMatch[2]!.trim() : undefined;

    // Parse time range (format: "0:15-0:24" or "7:41-7:56")
    const timeRangeResult = parseTimeRange(timeRange);
    if (!timeRangeResult) {
      continue;
    }

    const { startTime } = timeRangeResult;
    const { endTime } = timeRangeResult;
    const startSeconds = timeStringToSeconds(startTime);
    const endSeconds = timeStringToSeconds(endTime);
    const duration = roundDuration(endSeconds - startSeconds);

    // Normalize video type
    const normalizedType = videoTypeStr.toLowerCase().trim();
    let videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
    if (
      normalizedType === 'cinematic_realism' ||
      normalizedType === 'cinematic-realism' ||
      normalizedType === 'cinematic' ||
      normalizedType === 'animation' ||
      normalizedType === 'anim'
    ) {
      // Accept 'animation' for backward compatibility, but map to 'cinematic_realism'
      videoType = 'cinematic_realism';
    } else if (
      normalizedType === 'stock_footage' ||
      normalizedType === 'stock'
    ) {
      videoType = 'stock_footage';
    } else if (
      normalizedType === 'motion_graphics' ||
      normalizedType === 'motiongraphics' ||
      normalizedType === 'motion'
    ) {
      videoType = 'motion_graphics';
    } else {
      // Default to cinematic_realism if unknown
      videoType = 'cinematic_realism';
    }

    placements.push({
      placementNumber,
      startTime,
      endTime,
      videoType,
      prompt,
      duration,
      filename,
    });
  }

  placements.sort((a, b) => a.placementNumber - b.placementNumber);
  return placements;
}
