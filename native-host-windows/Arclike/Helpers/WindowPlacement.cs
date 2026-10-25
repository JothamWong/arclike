using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Arclike.Helpers
{
    /// <summary>
    /// Where a browser window is, in physical pixels, and the work area and scale of its monitor.
    /// The app is per-monitor DPI aware (app.manifest), so Win32 rectangles are physical pixels
    /// and a WPF size in device-independent units is multiplied by Scale to get pixels.
    /// </summary>
    public readonly record struct ScreenTarget(NativeMethods.RECT Frame, NativeMethods.RECT WorkArea, double Scale);

    public static class WindowPlacement
    {
        /// <summary>
        /// The visible frame of a top-level window. GetWindowRect also counts the invisible
        /// resize borders, about 7 px on each side, so DWM's extended frame bounds come first.
        /// </summary>
        public static ScreenTarget? ForWindow(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !Win32.IsWindow(hwnd)) return null;

            NativeMethods.RECT frame;
            if (Win32.DwmGetWindowAttribute(hwnd, Win32.DWMWA_EXTENDED_FRAME_BOUNDS, out frame, Marshal.SizeOf<NativeMethods.RECT>()) != 0
                && !NativeMethods.GetWindowRect(hwnd, out frame))
            {
                return null;
            }
            if (frame.Width < 100 || frame.Height < 100) return null;

            var monitor = NativeMethods.MonitorFromWindow(hwnd, NativeMethods.MONITOR_DEFAULTTONEAREST);
            return new ScreenTarget(frame, WorkArea(monitor) ?? frame, MonitorScale(monitor));
        }

        /// <summary>The monitor under the cursor, for when no browser window is known.</summary>
        public static ScreenTarget ForCursorMonitor()
        {
            Win32.GetCursorPos(out var point);
            var rect = new NativeMethods.RECT { Left = point.X, Top = point.Y, Right = point.X + 1, Bottom = point.Y + 1 };
            var monitor = Win32.MonitorFromRect(ref rect, NativeMethods.MONITOR_DEFAULTTONEAREST);
            var work = WorkArea(monitor) ?? new NativeMethods.RECT { Right = 1920, Bottom = 1080 };
            return new ScreenTarget(work, work, MonitorScale(monitor));
        }

        /// <summary>Move a window's top-left corner to a point in physical pixels, without activating it.</summary>
        public static void MoveTo(Window window, int x, int y)
        {
            var hwnd = new WindowInteropHelper(window).EnsureHandle();
            Win32.SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0,
                Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE | 0x0001 /* SWP_NOSIZE */);
        }

        /// <summary>Keep a span of `length` starting at `origin` inside [min, max].</summary>
        public static int Clamp(int origin, int length, int min, int max)
        {
            if (length >= max - min) return min;
            return Math.Max(min, Math.Min(origin, max - length));
        }

        private static NativeMethods.RECT? WorkArea(IntPtr monitor)
        {
            var info = new Win32.MONITORINFO { cbSize = Marshal.SizeOf<Win32.MONITORINFO>() };
            return Win32.GetMonitorInfo(monitor, ref info) ? info.rcWork : null;
        }

        private static double MonitorScale(IntPtr monitor)
        {
            try
            {
                // MDT_EFFECTIVE_DPI = 0
                if (NativeMethods.GetDpiForMonitor(monitor, 0, out uint dpiX, out _) == 0 && dpiX > 0)
                    return dpiX / 96.0;
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            return 1.0;
        }
    }
}
