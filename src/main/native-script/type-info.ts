const nativeServiceNames = ['NATIVE_TRAINING'] as const;

export type NativeServiceName = (typeof nativeServiceNames)[number];
