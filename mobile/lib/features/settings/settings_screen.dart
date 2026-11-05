import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../providers/app_providers.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    final notifications = ref.watch(notificationsEnabledProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Appearance', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.brightness_auto), label: Text('Auto')),
              ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_outlined), label: Text('Light')),
              ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_outlined), label: Text('Dark')),
            ],
            selected: {mode},
            onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
          ),
          const SizedBox(height: 28),
          const Text('Notifications', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Announcements'),
            subtitle: const Text('News and messages from GoalPulse. Alerts for followed teams and matches stay on.'),
            value: notifications,
            onChanged: (v) => ref.read(notificationsEnabledProvider.notifier).set(v),
          ),
          const SizedBox(height: 20),
          Text(
            'Kick-off times are shown in your device timezone.\nServer: ${AppConfig.apiBaseUrl}',
            style: TextStyle(fontSize: 12.5, color: context.mutedText),
          ),
        ],
      ),
    );
  }
}
