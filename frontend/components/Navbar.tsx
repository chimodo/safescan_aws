import React from 'react';
import { View, Text } from 'react-native';
import styles from '../app/styles';

export default function Navbar() {
  return (
    <View style={styles.navbar}>
      <View style={{ width: 32 }} />
      <Text style={styles.navLogo}>SAFESCAN</Text>
      <View style={styles.navIconBox}>
        <Text style={{ color: '#00e5ff', fontSize: 14 }}>⚙</Text>
      </View>
    </View>
  );
}
