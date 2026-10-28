import { App } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { create } from 'zustand'
import { alertFor, DEFAULT_ALERT_PREFS, type AlertAction, type AlertPrefs } from '../lib/alerts'
import { isNative, loadPref, savePref } from '../lib/native'
import { link } from '../lib/remote'
import { currentComputer, useLink } from './link'
import { useUi } from './ui'
import { useWorkspace } from './workspace'

// Phone notifications when a task finishes or the agent waits for the owner, and the background
// connection (ConnectionService in android/) that lets them arrive while the app is closed.

interface KeepAlive {
  start(o: { title: string; text: string }): Promise<void>
  stop(): Promise<void>
  setBusy(o: { busy: boolean }): Promise<void>
  batteryStatus(): Promise<{ unrestricted: boolean }>
  openBatterySettings(): Promise<void>
  openNotificationSettings(): Promise<void>
}
const KeepAlive = registerPlugin<KeepAlive>('KeepAlive')

export type Permission = 'granted' | 'denied' | 'prompt' | 'unknown'

interface AlertsState {
  prefs: AlertPrefs
  permission: Permission
  /** Android lets the app run without battery limits. */
  unrestricted: boolean | null
  /** Why the background connection couldn't start, if it couldn't. */
  backgroundError: string
  init: () => Promise<void>
  setPrefs: (patch: Partial<AlertPrefs>) => Promise<void>
  /** Asks Android for permission to show notifications (once it says no, only its settings can change that). */
  askPermission: () => Promise<Permission>
  refreshStatus: () => Promise<void>
  test: () => Promise<void>
  openNotificationSettings: () => void
  openBatterySettings: () => void
}

let active = true
let finishedCount = 0
let started = false

const wantsAlerts = (p: AlertPrefs): boolean => p.finished || p.waiting

async function show(actions: AlertAction[]): Promise<void> {
  for (const a of actions) {
    try {
      if (a.kind === 'cancel') await LocalNotifications.cancel({ notifications: [{ id: a.id }] })
      else {
        if (a.channel === 'finished') finishedCount++
        await LocalNotifications.schedule({
          notifications: [
            {
              id: a.id,
              title: a.title,
              body: a.body,
              largeBody: a.body,
              channelId: a.channel,
              smallIcon: 'ic_stat_rulz',
              iconColor: '#ED000D',
              autoCancel: true,
              extra: { kind: a.channel }
            }
          ]
        })
      }
    } catch {
      // No permission or no notifications here; nothing else to do.
    }
  }
}

export const useAlerts = create<AlertsState>((set, get) => {
  /** Starts or stops the background connection to match the settings and the chosen computer. */
  const syncBackground = async (): Promise<void> => {
    if (!isNative) return
    const { prefs } = get()
    const computer = currentComputer()
    try {
      if (computer && prefs.background && wantsAlerts(prefs)) {
        await KeepAlive.start({ title: `Watching ${computer.name}`, text: 'You’ll get a notification when a task finishes or needs you.' })
        await KeepAlive.setBusy({ busy: useWorkspace.getState().running })
      } else {
        await KeepAlive.stop()
      }
      set({ backgroundError: '' })
    } catch (e) {
      set({ backgroundError: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    prefs: DEFAULT_ALERT_PREFS,
    permission: 'unknown',
    unrestricted: null,
    backgroundError: '',

    init: async () => {
      if (started) return
      started = true
      set({ prefs: { ...DEFAULT_ALERT_PREFS, ...(await loadPref<Partial<AlertPrefs>>('alerts', {})) } })
      try {
        await LocalNotifications.createChannel({
          id: 'waiting',
          name: 'Waiting for you',
          description: 'Permission requests, questions and pauses',
          importance: 5,
          vibration: true,
          visibility: 1
        })
        await LocalNotifications.createChannel({ id: 'finished', name: 'Task finished', description: 'A task finished on your computer', importance: 4, visibility: 1 })
      } catch {
        // Channels only exist on Android.
      }

      if (isNative) {
        void App.addListener('appStateChange', ({ isActive }) => {
          active = isActive
          // Starting the background connection is only allowed while the app is open.
          if (isActive) {
            void syncBackground()
            void get().refreshStatus()
          }
        })
      } else {
        document.addEventListener('visibilitychange', () => (active = document.visibilityState === 'visible'))
      }

      // Tapping a notification opens the project (the approval sheet shows itself).
      void LocalNotifications.addListener('localNotificationActionPerformed', () => {
        if (useWorkspace.getState().project) {
          useUi.getState().go('workspace')
          useUi.getState().setTab('chat')
        }
      })

      link.on('agent:event', (e) => {
        if (e.type === 'task-start' || e.type === 'task-end') void KeepAlive.setBusy({ busy: e.type === 'task-start' }).catch(() => undefined)
        const actions = alertFor(e, {
          prefs: get().prefs,
          projectName: useWorkspace.getState().project?.name ?? 'your project',
          timeline: useWorkspace.getState().timeline,
          finishedCount
        })
        // While the app is open the conversation and the approval sheet show it already; only clear old ones.
        void show(active ? actions.filter((a) => a.kind === 'cancel') : actions)
      })

      useLink.subscribe((s, prev) => {
        if (s.currentId !== prev.currentId) void syncBackground()
      })
      // Ask once, when the app first connects to a computer.
      link.onState((s) => {
        if (s.kind !== 'connected') return
        void syncBackground()
        void loadPref<boolean>('alertsAsked', false).then(async (asked) => {
          if (asked || !wantsAlerts(get().prefs)) return
          await savePref('alertsAsked', true)
          await get().askPermission()
        })
      })
      await get().refreshStatus()
    },

    setPrefs: async (patch) => {
      const prefs = { ...get().prefs, ...patch }
      set({ prefs })
      await savePref('alerts', prefs)
      if ((patch.finished || patch.waiting) && get().permission !== 'granted') await get().askPermission()
      await syncBackground()
    },

    askPermission: async () => {
      try {
        const r = await LocalNotifications.requestPermissions()
        const permission: Permission = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt'
        set({ permission })
        return permission
      } catch {
        return get().permission
      }
    },

    refreshStatus: async () => {
      try {
        const r = await LocalNotifications.checkPermissions()
        set({ permission: r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt' })
      } catch {
        set({ permission: 'unknown' })
      }
      if (isNative) {
        try {
          set({ unrestricted: (await KeepAlive.batteryStatus()).unrestricted })
        } catch {
          set({ unrestricted: null })
        }
      }
    },

    test: async () => {
      if (get().permission !== 'granted' && (await get().askPermission()) !== 'granted') return
      await show([{ kind: 'show', id: 99, channel: 'finished', title: 'Notifications work', body: 'This is how RulZ Agent will tell you a task is done or needs you.' }])
    },

    openNotificationSettings: () => void KeepAlive.openNotificationSettings().catch(() => undefined),
    openBatterySettings: () => void KeepAlive.openBatterySettings().catch(() => undefined)
  }
})
