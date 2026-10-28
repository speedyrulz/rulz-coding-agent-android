package com.rulz.codingagent.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Starts and stops ConnectionService from the app, and opens the Android settings pages notifications depend on. */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    /** Starts (or updates) the background connection: { title, text }. */
    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), ConnectionService.class)
            .putExtra(ConnectionService.EXTRA_TITLE, call.getString("title", "Connected"))
            .putExtra(ConnectionService.EXTRA_TEXT, call.getString("text", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            // Android doesn't allow starting it while the app is in the background; the app tries again when it's opened.
            call.reject("Couldn't stay connected in the background: " + e.getMessage());
        }
    }

    /** { busy }: a task is running on the computer. Works while the app is in the background. */
    @PluginMethod
    public void setBusy(PluginCall call) {
        ConnectionService.setBusy(Boolean.TRUE.equals(call.getBoolean("busy", false)));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), ConnectionService.class));
        call.resolve();
    }

    /** Whether Android lets the app run without battery limits. */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("unrestricted", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(result);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        }
        open(intent, call);
    }

    private void open(Intent intent, PluginCall call) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open Android settings: " + e.getMessage());
        }
    }
}
