import React, { ComponentProps, useContext } from 'react';
import { TextInput as NativeTextInput } from 'react-native';
import { FontsLoadedContext } from './FontsLoadedContext';

export default function AppTextInput(props: ComponentProps<typeof NativeTextInput>) {
  const fontsLoaded = useContext(FontsLoadedContext);
  return (
    <NativeTextInput
      {...props}
      style={[fontsLoaded ? { fontFamily: 'Montserrat_400Regular' } : undefined, props.style]}
    />
  );
}
