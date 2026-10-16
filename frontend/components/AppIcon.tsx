import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { COLORS } from '../constants/colors';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export default function AppIcon({
  name,
  size = 20,
  color = COLORS.navy,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
