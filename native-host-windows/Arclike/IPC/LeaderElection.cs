using System;
using System.Threading;
using Arclike.Helpers;

namespace Arclike.IPC
{
    /// <summary>
    /// Mutex-based leader election for keyboard hook ownership. Port of tryBecomeEventTapLeader
    /// in main.swift. Windows releases a named mutex when its owner dies, so a crashed leader
    /// leaves no stale lock: the next attempt gets an abandoned mutex, which counts as owned.
    ///
    /// A mutex belongs to the thread that took it, so call every method on the UI thread.
    /// </summary>
    public class LeaderElection : IDisposable
    {
        private readonly Mutex _mutex = new(false, Constants.EventTapMutexName);
        public bool IsLeader { get; private set; }

        /// <summary>Try to take leadership. Returns true if this instance is the leader.</summary>
        public bool TryBecomeLeader()
        {
            if (IsLeader) return true;
            try
            {
                IsLeader = _mutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                // The previous owner died. The wait still succeeded.
                IsLeader = true;
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Failed to take the hook mutex: {ex.Message}");
                IsLeader = false;
            }

            DebugLogger.Log(IsLeader
                ? $"We (PID {Environment.ProcessId}) own the keyboard hook"
                : $"Another instance owns the keyboard hook, we (PID {Environment.ProcessId}) listen only");
            return IsLeader;
        }

        public void Release()
        {
            if (!IsLeader) return;
            try
            {
                _mutex.ReleaseMutex();
                DebugLogger.Log("Released the hook mutex");
            }
            catch (Exception ex)
            {
                DebugLogger.Log($"Error releasing the hook mutex: {ex.Message}");
            }
            IsLeader = false;
        }

        public void Dispose()
        {
            Release();
            _mutex.Dispose();
        }
    }
}
