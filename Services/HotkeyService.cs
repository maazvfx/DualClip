using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace DualClip.Services;

public class HotkeyService : IDisposable
{
    private IntPtr _hwnd;
    private const int WM_HOTKEY = 0x0312;
    private const int MOD_ALT = 0x0001;
    private const int MOD_CONTROL = 0x0002;
    private const int MOD_SHIFT = 0x0004;
    private const int MOD_NOREPEAT = 0x4000;

    private const int HOTKEY_ID_WIN_V = 9001;
    private const int HOTKEY_ID_CTRL_SHIFT_V = 9002;
    private const int HOTKEY_ID_CUSTOM = 9003;

    // Low-Level Keyboard Hook constants
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_CONTROL = 0x11;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_SHIFT = 0x10;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int VK_MENU = 0x12;

    public event Action? HotkeyPressed;

    private IntPtr _llHookId = IntPtr.Zero;
    private readonly LowLevelKeyboardProc _llProc;
    private bool _winVDown = false;

    private bool _targetWin;
    private bool _targetCtrl;
    private bool _targetAlt;
    private bool _targetShift;
    private int _targetVk = (int)Keys.V;

    public HotkeyService(IntPtr hwnd)
    {
        _hwnd = hwnd;
        _llProc = HookCallback;
        RegisterDefaultHotkeys();
    }

    public void ReRegister(IntPtr newHwnd)
    {
        StopLlHook();
        UnregisterAll();
        _hwnd = newHwnd;

        if (_targetWin)
        {
            StartLlHook();
        }
        else
        {
            int mods = MOD_NOREPEAT;
            if (_targetCtrl) mods |= MOD_CONTROL;
            if (_targetAlt) mods |= MOD_ALT;
            if (_targetShift) mods |= MOD_SHIFT;

            bool ok = RegisterHotKey(_hwnd, HOTKEY_ID_CUSTOM, mods, _targetVk);
            if (!ok)
            {
                RegisterHotKey(_hwnd, HOTKEY_ID_CTRL_SHIFT_V, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, (int)Keys.V);
            }
        }
    }

    public void RegisterDefaultHotkeys()
    {
        StopLlHook();
        UnregisterAll();
        _targetWin = false;
        _targetCtrl = true;
        _targetAlt = false;
        _targetShift = true;
        _targetVk = (int)Keys.V;
        RegisterHotKey(_hwnd, HOTKEY_ID_CTRL_SHIFT_V, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, (int)Keys.V);
    }

    public bool UpdateCustomHotkey(bool win, bool ctrl, bool alt, bool shift, int vk)
    {
        StopLlHook();
        UnregisterAll();

        _targetWin = win;
        _targetCtrl = ctrl;
        _targetAlt = alt;
        _targetShift = shift;
        _targetVk = vk > 0 ? vk : (int)Keys.V;

        if (win)
        {
            StartLlHook();
            return _llHookId != IntPtr.Zero;
        }
        else
        {
            int mods = MOD_NOREPEAT;
            if (ctrl) mods |= MOD_CONTROL;
            if (alt) mods |= MOD_ALT;
            if (shift) mods |= MOD_SHIFT;

            bool ok = RegisterHotKey(_hwnd, HOTKEY_ID_CUSTOM, mods, _targetVk);
            if (!ok)
            {
                RegisterHotKey(_hwnd, HOTKEY_ID_CTRL_SHIFT_V, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, (int)Keys.V);
            }
            return ok;
        }
    }

    public void ProcessHotkeyMessage(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            var id = m.WParam.ToInt32();
            if (id == HOTKEY_ID_WIN_V || id == HOTKEY_ID_CTRL_SHIFT_V || id == HOTKEY_ID_CUSTOM)
            {
                HotkeyPressed?.Invoke();
            }
        }
    }

    private void StartLlHook()
    {
        if (_llHookId != IntPtr.Zero) return;
        try
        {
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;
            var hMod = curModule != null ? GetModuleHandle(curModule.ModuleName) : IntPtr.Zero;
            _llHookId = SetWindowsHookEx(WH_KEYBOARD_LL, _llProc, hMod, 0);
        }
        catch
        {
        }
    }

    private void StopLlHook()
    {
        if (_llHookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_llHookId);
            _llHookId = IntPtr.Zero;
        }
        _winVDown = false;
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            if (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                if (vkCode == _targetVk)
                {
                    bool winDown = (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
                    bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_LCONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_RCONTROL) & 0x8000) != 0;
                    bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                    bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0 || (GetAsyncKeyState(VK_LSHIFT) & 0x8000) != 0 || (GetAsyncKeyState(VK_RSHIFT) & 0x8000) != 0;

                    if (winDown == _targetWin && ctrlDown == _targetCtrl && altDown == _targetAlt && shiftDown == _targetShift)
                    {
                        if (!_winVDown)
                        {
                            _winVDown = true;
                            // Asynchronous dispatch ensures low-level hook callback returns (IntPtr)1 immediately
                            // and never triggers Windows LowLevelHooksTimeout unhooking under load.
                            ThreadPool.QueueUserWorkItem(_ => HotkeyPressed?.Invoke());
                        }
                        return (IntPtr)1;
                    }
                }
            }
            else if (wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                bool isTargetKey = vkCode == _targetVk;
                bool isWinKey = vkCode == VK_LWIN || vkCode == VK_RWIN;
                bool isCtrlKey = vkCode == VK_CONTROL || vkCode == VK_LCONTROL || vkCode == VK_RCONTROL;
                bool isShiftKey = vkCode == VK_SHIFT || vkCode == VK_LSHIFT || vkCode == VK_RSHIFT;
                bool isAltKey = vkCode == VK_MENU;

                // Release the fire latch when the target key OR any participating modifier goes up,
                // so out-of-order modifier release can never leave the latch stuck.
                if (isTargetKey
                    || (_targetWin && isWinKey)
                    || (_targetCtrl && isCtrlKey)
                    || (_targetShift && isShiftKey)
                    || (_targetAlt && isAltKey))
                {
                    _winVDown = false;
                }
            }
        }
        return CallNextHookEx(_llHookId, nCode, wParam, lParam);
    }

    private void UnregisterAll()
    {
        UnregisterHotKey(_hwnd, HOTKEY_ID_WIN_V);
        UnregisterHotKey(_hwnd, HOTKEY_ID_CTRL_SHIFT_V);
        UnregisterHotKey(_hwnd, HOTKEY_ID_CUSTOM);
    }

    public void Dispose()
    {
        StopLlHook();
        UnregisterAll();
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
