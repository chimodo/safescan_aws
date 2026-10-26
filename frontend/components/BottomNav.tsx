import React from 'react';
import { View, Text } from 'react-native';
import styles from '../app/styles';

export default function BottomNav() {
  const items = [
    { icon: '⬡', label: 'SCAN', active: true },
    { icon: '◈', label: 'HISTORY', active: false },
    { icon: '◎', label: 'DATABASE', active: false },
    { icon: '◇', label: 'SETTINGS', active: false },
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => (
        <View key={item.label} style={styles.navItem}>
          <Text style={[styles.navItemIcon, item.active ? styles.navItemActive : styles.navItemInactive]}>
            {item.icon}
          </Text>
          <Text style={[styles.navItemLabel, item.active ? styles.navItemActive : styles.navItemInactive]}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
