/**
 * StealStickers — Kettu / Bunny Plugin
 *
 * Adds a "📥 Download Sticker" button to the long-press sticker context menu.
 * Allows you to save/download stickers from any message to your device.
 *
 * Inspired by Stealmoji by Fierdetta
 * Ported for Kettu/Bunny using FavouriteAnything pattern
 */

import { findByProps } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

const { Platform } = RN;

// ---------------------------------------------------------------------------
// Lazy module cache
// ---------------------------------------------------------------------------
let _stickerActions = null;   // Module that builds sticker context menu options
let _fileManager = null;       // Module for downloading files

/**
 * Find the module that handles sticker context menu actions.
 * Discord mobile typically has actions like "Mark as Read", etc.
 */
function getStickerActionsModule() {
    if (_stickerActions) return _stickerActions;
    try {
        // Try to find by common sticker-related props
        _stickerActions = 
            findByProps("openStickerPickerActionSheet", false) ||
            findByProps("getStickerById", false) ||
            findByProps("fetchSticker", false);
    } catch (e) {
        console.warn("[StealStickers] Could not find sticker actions module:", e);
    }
    return _stickerActions;
}

/**
 * Find Discord's file download/save module
 */
function getFileManagerModule() {
    if (_fileManager) return _fileManager;
    try {
        _fileManager = 
            findByProps("downloadFile", false) ||
            findByProps("saveFile", false) ||
            findByProps("downloadAsset", false);
    } catch (e) {
        console.warn("[StealStickers] Could not find file manager module:", e);
    }
    return _fileManager;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Extract sticker information from a message or sticker object
 * @param {object} context - Could be message object or direct sticker data
 * @returns {{ id: string, name: string, url: string, format: string } | null}
 */
function extractStickerInfo(context) {
    if (!context) return null;

    // Try to extract sticker from message.stickers array
    if (context.stickers && Array.isArray(context.stickers) && context.stickers.length > 0) {
        const sticker = context.stickers[0]; // First sticker in message
        return {
            id: sticker.id,
            name: sticker.name || "sticker",
            url: getStickerURL(sticker),
            format: sticker.format_type || 1  // 1 = PNG, 2 = APNG, 3 = Lottie
        };
    }

    // Try direct sticker object (if context IS the sticker)
    if (context.id && context.format_type) {
        return {
            id: context.id,
            name: context.name || "sticker",
            url: getStickerURL(context),
            format: context.format_type || 1
        };
    }

    return null;
}

/**
 * Build CDN URL for a sticker
 * @param {object} sticker - Sticker data object
 * @returns {string} Full CDN URL
 */
function getStickerURL(sticker) {
    const format = sticker.format_type === 3 ? "json" : "png"; // Lottie = JSON, others = PNG
    return `https://cdn.discordapp.com/stickers/${sticker.id}.${format}`;
}

/**
 * Get file extension based on sticker format
 */
function getFileExtension(formatType) {
    switch (formatType) {
        case 1: return "png";     // PNG
        case 2: return "apng";    // APNG (animated PNG)
        case 3: return "json";    // Lottie JSON
        default: return "png";
    }
}

/**
 * Download sticker to device
 */
async function downloadSticker(stickerInfo) {
    try {
        const fileManager = getFileManagerModule();
        const ext = getFileExtension(stickerInfo.format);
        const filename = `${stickerInfo.name.replace(/[^a-zA-Z0-9]/g, "_")}_${stickerInfo.id}.${ext}`;

        // Try using Discord's native download function
        if (fileManager?.downloadFile) {
            await fileManager.downloadFile(stickerInfo.url, filename);
            showToast(`Downloaded ${stickerInfo.name}! 📥`);
            return;
        }

        if (fileManager?.saveFile) {
            await fileManager.saveFile(stickerInfo.url, filename);
            showToast(`Saved ${stickerInfo.name}! 📥`);
            return;
        }

        // Fallback: Use React Native's Linking or Clipboard
        if (Platform.OS === "android" || Platform.OS === "ios") {
            // Try to open in browser as last resort
            const { Linking } = RN;
            await Linking.openURL(stickerInfo.url);
            showToast("Opened sticker URL in browser 🌐");
        } else {
            showToast("Download not supported on this platform ❌");
        }

    } catch (e) {
        console.error("[StealStickers] Download failed:", e);
        showToast(`Failed to download sticker: ${e.message}` );
    }
}

// ---------------------------------------------------------------------------
// Build the action item
// ---------------------------------------------------------------------------

/**
 * Creates the "Download Sticker" action for the context menu
 */
function buildDownloadAction(stickerInfo) {
    return {
        key: "stealSticker",
        label: "📥 Download Sticker",
        onPress: () => {
            downloadSticker(stickerInfo);
        }
    };
}

// ---------------------------------------------------------------------------
// Patching logic
// ---------------------------------------------------------------------------

let unpatch = null;

function applyPatch() {
    // Get patcher from global bunny object
    const bunnyAPI = typeof window !== "undefined" ? window.bunny : null;
    const { patcher } = bunnyAPI || {};
    
    if (!patcher || typeof patcher.after !== "function") {
        console.error("[StealStickers] Patcher not available!");
        return;
    }

    // Strategy: Patch the message context menu builder
    // This is similar to how FavouriteAnything patches message actions
    try {
        const messageActionsModule = findByProps("markAsUnread", "suppressEmbeds", false);
        
        if (!messageActionsModule) {
            console.warn("[StealStickers] Could not find message actions module");
            return;
        }

        // Find the patchable function
        const candidates = ["getActions", "buildActions", "default"];
        let patchKey = null;

        for (const name of candidates) {
            if (typeof messageActionsModule[name] === "function") {
                patchKey = name;
                break;
            }
        }

        if (!patchKey) {
            console.error(
                "[StealStickers] No patchable function found. " +
                "Available keys:",
                Object.keys(messageActionsModule)
            );
            return;
        }

        unpatch = patcher.after(patchKey, messageActionsModule, function afterActions(args, ret) {
            // Extract message from args
            const message =
                (args[0] && args[0].message) ||
                args[0] ||
                null;

            const stickerInfo = extractStickerInfo(message);
            if (!stickerInfo) return ret; // No sticker, don't modify menu

            // Inject our download action

            // Shape A: ret is the options array
            if (Array.isArray(ret)) {
                ret.push(buildDownloadAction(stickerInfo));
                return ret;
            }

            // Shape B: ret is a React element with options in props
            if (ret && ret.props) {
                if (Array.isArray(ret.props.options)) {
                    ret.props.options.push(buildDownloadAction(stickerInfo));
                    return ret;
                }
                // One level deeper
                if (Array.isArray(ret.props.children)) {
                    for (const child of ret.props.children) {
                        if (child && child.props && Array.isArray(child.props.options)) {
                            child.props.options.push(buildDownloadAction(stickerInfo));
                            return ret;
                        }
                    }
                }
            }

            return ret;
        });

        console.log("[StealStickers] Patch applied");

    } catch (e) {
        console.error("[StealStickers] Failed to apply patch:", e);
    }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
    onLoad: () => {
        try {
            applyPatch();
            console.log("[StealStickers] Enabled 📥");
        } catch (e) {
            console.error("[StealStickers] Failed to enable:", e);
            // Clean up on failure
            if (typeof unpatch === "function") {
                try {
                    unpatch();
                } catch {}
                unpatch = null;
            }
        }
    },

    onUnload: () => {
        // Immediate cleanup
        const patchToRemove = unpatch;
        unpatch = null;
        _stickerActions = null;
        _fileManager = null;
        
        if (typeof patchToRemove === "function") {
            try {
                patchToRemove();
            } catch (e) {
                console.error("[StealStickers] Error during unpatch:", e);
            }
        }
        
        console.log("[StealStickers] Disabled");
    }
};
