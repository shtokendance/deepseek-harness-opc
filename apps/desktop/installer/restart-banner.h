#pragma once
#include <algorithm>
#include <new>
#include "restart-text.h"
namespace restart_banner {
constexpr wchar_t stateKey[] = L"HarnessInstaller.RestartBanner";
constexpr int iconId = 0xffff, titleId = 76, bodyId = 1030;
constexpr UINT_PTR progressTimerId = 1;
constexpr int progressCycleTicks = 72;
struct Style {
    DLGPROC previous;
    HBRUSH brush;
    HFONT font;
    HFONT titleFont;
    COLORREF background;
    COLORREF foreground;
    HBITMAP bitmap;
    bool dark;
    int barLeft;
    int barTop;
    int barWidth;
    int barHeight;
    int tick;
};

inline void PaintProgressBar(HDC dc, const Style& state) {
    if (state.barWidth <= 0 || state.barHeight <= 0) return;
    const int saved = SaveDC(dc);
    const int radius = std::max<int>(2, state.barHeight);
    SelectObject(dc, GetStockObject(NULL_PEN));
    SelectObject(dc, GetStockObject(DC_BRUSH));
    SetDCBrushColor(dc, state.dark ? RGB(58, 61, 68) : RGB(233, 236, 242));
    RoundRect(dc, state.barLeft, state.barTop,
        state.barLeft + state.barWidth + 1, state.barTop + state.barHeight + 1, radius, radius);
    const HRGN clip = CreateRoundRectRgn(state.barLeft, state.barTop,
        state.barLeft + state.barWidth + 1, state.barTop + state.barHeight + 1, radius, radius);
    if (clip) {
        SelectClipRgn(dc, clip);
        const int pillWidth = std::max<int>(state.barHeight * 3, state.barWidth * 36 / 100);
        const int travel = state.barWidth + pillWidth;
        const int pillLeft = state.barLeft - pillWidth + (travel * state.tick) / progressCycleTicks;
        SetDCBrushColor(dc, RGB(0, 102, 255));
        RoundRect(dc, pillLeft, state.barTop,
            pillLeft + pillWidth + 1, state.barTop + state.barHeight + 1, radius, radius);
        DeleteObject(clip);
    }
    if (saved) RestoreDC(dc, saved);
}

inline INT_PTR CALLBACK DialogProc(HWND window, UINT message, WPARAM wp, LPARAM lp) {
    auto* state = static_cast<Style*>(GetPropW(window, stateKey));
    if (message == WM_NCCALCSIZE && wp) {
        SetWindowLongPtrW(window, DWLP_MSGRESULT, 0);
        return TRUE;
    }
    // Static labels pass pointer hits to the dialog. Let Windows own the move loop.
    if (message == WM_NCHITTEST) {
        SetWindowLongPtrW(window, DWLP_MSGRESULT, HTCAPTION);
        return TRUE;
    }
    if (message == WM_TIMER && wp == progressTimerId && state) {
        state->tick = (state->tick + 1) % progressCycleTicks;
        RECT bar{state->barLeft, state->barTop, state->barLeft + state->barWidth, state->barTop + state->barHeight};
        InvalidateRect(window, &bar, FALSE);
        return TRUE;
    }
    if (message == WM_PAINT || message == WM_PRINTCLIENT) {
        PAINTSTRUCT paint{};
        HDC dc = message == WM_PAINT ? BeginPaint(window, &paint) : reinterpret_cast<HDC>(wp);
        RECT bounds{};
        GetClientRect(window, &bounds);
        FillRect(dc, &bounds, state->brush);
        PaintProgressBar(dc, *state);

        if (message == WM_PAINT) EndPaint(window, &paint);
        return TRUE;
    }
    if (message == WM_CTLCOLORDLG || message == WM_CTLCOLORSTATIC) {
        const auto dc = reinterpret_cast<HDC>(wp);
        SetTextColor(dc, state->foreground);
        SetBkColor(dc, state->background);
        return reinterpret_cast<INT_PTR>(state->brush);
    }
    auto result = state->previous(window, message, wp, lp);
    if (message == WM_NCDESTROY) {
        KillTimer(window, progressTimerId);
        RemovePropW(window, stateKey);
        DeleteObject(state->font);
        DeleteObject(state->brush);
        DeleteObject(state->titleFont);
        DeleteObject(state->bitmap);
        delete state;
    }
    return result;
}
}

// Size the localized paragraph with the font and wrapping used by its static control.
static void InstallerStyleRestartBanner(HWND window, LPCWSTR text,
    LPCWSTR locale, LPCWSTR face, int logicalFontSize, COLORREF background, COLORREF foreground) {
    const HWND label = GetDlgItem(window, restart_banner::bodyId);
    const HWND icon = GetDlgItem(window, restart_banner::iconId);
    if (!label || !icon) return;
    const HMODULE user = GetModuleHandleW(L"user32.dll");
#pragma warning(push)
#pragma warning(disable: 4191)
    const auto getDpi = reinterpret_cast<decltype(&GetDpiForWindow)>(GetProcAddress(user, "GetDpiForWindow"));
#pragma warning(pop)
    const UINT dpi = getDpi ? getDpi(window) : 96;
    const auto px = [dpi](int value) { return MulDiv(value, dpi, 96); };
    HMODULE module;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&restart_banner::DialogProc), &module)) return;
    const BOOL dark = background != RGB(255, 255, 255);
    auto* state = new (std::nothrow) restart_banner::Style{
        reinterpret_cast<DLGPROC>(GetWindowLongPtrW(window, DWLP_DLGPROC)), CreateSolidBrush(background),
        CreateFontW(-px(logicalFontSize), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, face),
        CreateFontW(-px(16), 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, face),
        background, foreground, nullptr, dark != FALSE, 0, 0, 0, 0, 0};
    if (!state) return;
    if (!state->brush || !state->titleFont || !state->font || !SetPropW(window, restart_banner::stateKey, state)) {
        DeleteObject(state->font);
        DeleteObject(state->brush);
        DeleteObject(state->titleFont);
        delete state;
        return;
    }
    SetWindowLongPtrW(window, DWLP_DLGPROC, reinterpret_cast<LONG_PTR>(&restart_banner::DialogProc));
    const int padding = px(20), gap = px(12), iconSize = px(32), width = px(388);
    RECT paragraph{0, 0, width - 2 * padding - gap - iconSize, 0};
    HDC dc = GetDC(window);
    HGDIOBJ previous = SelectObject(dc, state->font);
    DrawTextW(dc, text, -1, &paragraph, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX | DT_EDITCONTROL);
    SelectObject(dc, previous);
    ReleaseDC(window, dc);
    const int bodyWidth = width - 2 * padding - gap - iconSize;
    HBITMAP bitmap = RenderRestartParagraph(window, text, face, locale, logicalFontSize, bodyWidth, dpi, background, foreground, paragraph.bottom);
    state->bitmap = bitmap;
    const int titleHeight = px(22), titleGap = px(4);
    const int textHeight = titleHeight + titleGap + paragraph.bottom;
    const int contentHeight = std::max<int>(iconSize, textHeight);
    const int barGap = px(14), barHeight = px(5);
    const int height = 2 * padding + contentHeight + barGap + barHeight;
    state->barLeft = padding;
    state->barTop = padding + contentHeight + barGap;
    state->barWidth = width - 2 * padding;
    state->barHeight = barHeight;
    SetTimer(window, restart_banner::progressTimerId, 28, nullptr);
    // The stock Banner dialog has a raised system edge outside the themed client area.
    SetWindowLongPtrW(window, GWL_STYLE, GetWindowLongPtrW(window, GWL_STYLE) & ~DS_MODALFRAME);
    SetWindowLongPtrW(window, GWL_EXSTYLE, GetWindowLongPtrW(window, GWL_EXSTYLE) &
        ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE));
    DwmSetWindowAttribute(window, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
    ApplyInstallerDwmFrame(window);
    RECT client{}, outer{};
    GetClientRect(window, &client);
    GetWindowRect(window, &outer);
    const int newWidth = width + outer.right - outer.left - client.right;
    const int newHeight = height + outer.bottom - outer.top - client.bottom;
    SetWindowPos(window, nullptr, (outer.left + outer.right - newWidth) / 2,
        (outer.top + outer.bottom - newHeight) / 2, newWidth, newHeight, SWP_NOACTIVATE | SWP_NOZORDER);
    const HWND title = GetDlgItem(window, restart_banner::titleId);
    SetWindowLongPtrW(title, GWL_STYLE, (GetWindowLongPtrW(title, GWL_STYLE) & ~SS_TYPEMASK) | SS_LEFT | SS_NOPREFIX);
    SetWindowTextW(title, L"WorkOPC");
    SendMessageW(title, WM_SETFONT, reinterpret_cast<WPARAM>(state->titleFont), FALSE);
    SetWindowPos(title, nullptr, padding + iconSize + gap, padding + (contentHeight - textHeight) / 2,
        width - 2 * padding - gap - iconSize, titleHeight, SWP_NOZORDER | SWP_SHOWWINDOW);
    const LONG_PTR style = GetWindowLongPtrW(label, GWL_STYLE);
    SetWindowLongPtrW(label, GWL_STYLE, (style & ~SS_TYPEMASK) | SS_LEFT | SS_NOPREFIX | SS_EDITCONTROL);
    SendMessageW(label, WM_SETFONT, reinterpret_cast<WPARAM>(state->font), FALSE);
    SetWindowPos(icon, nullptr, padding, padding + (contentHeight - iconSize) / 2, iconSize, iconSize, SWP_NOZORDER);
    SetWindowPos(label, nullptr, padding + iconSize + gap, padding + (contentHeight - textHeight) / 2 + titleHeight + titleGap,
        width - 2 * padding - gap - iconSize, paragraph.bottom, SWP_NOZORDER);
    if (bitmap) {
        SetWindowLongPtrW(label, GWL_STYLE, (GetWindowLongPtrW(label, GWL_STYLE) & ~SS_TYPEMASK) | SS_BITMAP);
        SendMessageW(label, STM_SETIMAGE, IMAGE_BITMAP, reinterpret_cast<LPARAM>(bitmap));
    }
    RedrawWindow(window, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW);
}
