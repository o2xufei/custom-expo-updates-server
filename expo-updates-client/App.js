import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Image, Button, Alert } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from "expo-updates";
import { useCallback, useEffect, useState } from "react";
import NetInfo from '@react-native-community/netinfo';

export default function App() {
  const [isOnline, setIsOnline] = useState(false);
  const [isNetworkReady, setIsNetworkReady] = useState(false); // 新增网络状态准备标志
  const [message, setMessage] = useState("");
  const [isUpdateConfigured, setIsUpdateConfigured] = useState(false);

  // 在应用启动时检查更新配置
  useEffect(() => {
    const updateUrl = Updates.updateUrl || Constants.expoConfig?.updates?.url;
    if (!updateUrl) {
      Alert.alert(
        '配置错误', 
        '应用更新功能未正确配置，请联系技术支持',
        [{ text: '确定' }]
      );
    } else {
      setIsUpdateConfigured(true);
      // 确保Updates模块使用正确的URL
      if (!Updates.updateUrl) {
        console.warn('Updates.updateUrl为空，使用备用URL');
      }
    }
  }, []);

  // 在组件中添加网络状态监听
  useEffect(() => {
    let isMounted = true;
    const unsubscribe = NetInfo.addEventListener(async state => {
      console.log('网络连接状态:', state.isConnected);
      if (isMounted) {
        setIsOnline(state.isConnected);
        setIsNetworkReady(true); // 标记网络状态已准备就绪
        if (!state.isConnected) { 
          console.warn('网络已断开');
        }
      }
    });

    // 主动获取一次网络状态，避免等待事件触发
    NetInfo.fetch().then(state => {
      if (isMounted) {
        setIsOnline(state.isConnected);
        setIsNetworkReady(true);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // 用于调试网络状态变化
  useEffect(() => {
    console.log('网络状态变化:', isOnline);
  }, [isOnline]);

  const checkForUpdates = useCallback(async () => {
    try {
      console.log('开始更新，网络状态准备:', isNetworkReady, '当前网络状态:', isOnline);
      
      // if (!isNetworkReady) {
      //   Alert.alert('请稍候', '正在检测网络状态...');
      //   return;
      // }
      
      // if (isOnline === false) {
      //   Alert.alert('网络未连接', '请检查网络连接');
      //   return;
      // }

      // 检查更新URL配置
      const updateUrl = Updates.updateUrl || Constants.expoConfig?.updates?.url;
      if (!updateUrl) {
        Alert.alert('配置错误', '未配置更新服务器URL');
        return;
      }

      console.log('当前配置的更新URL:', updateUrl);
      console.log('Updates.updateUrl:', Updates.updateUrl);
      console.log('Constants.expoConfig.updates.url:', Constants.expoConfig?.updates?.url);
      setMessage(`当前配置的更新URL: ${updateUrl}\n` +
                `原生模块URL: ${Updates.updateUrl}\n` +
                `JS配置URL: ${Constants.expoConfig?.updates?.url}\n` +
              `当前是否联网：${isOnline}` );
      console.log('完整的运行时配置:', JSON.stringify(Constants.expoConfig, null, 2));
      console.log('Updates配置:', JSON.stringify(Updates, null, 2));
      
      const update = await Updates.checkForUpdateAsync();
      console.log('更新检查结果:', update);
      
      if (!update.isAvailable) {
        Alert.alert("提示", "已是最新版本");
        return;
      }

      Alert.alert(
        "发现新版本",
        `当前版本: ${Constants.expoConfig.version}\n` +
          `新版本: ${update.manifest.version}\n` +
          `运行时版本: ${update.manifest.runtimeVersion}\n` +
          `发布时间: ${new Date(update.manifest.createdAt).toLocaleString()}\n` +
          `更新说明: ${update.manifest.extra?.expoClient?.description || "无"}\n\n` +
          "是否立即更新？",
        [
          {
            text: "稍后",
            style: "cancel",
          },
          {
            text: "立即更新",
            onPress: async () => {
              try {
                console.log("开始下载更新...");
                Alert.alert("更新中", "正在下载更新，请稍候...");
                const result = await Updates.fetchUpdateAsync();
                console.log("更新下载完成，结果：", {
                  isNew: result.isNew,
                  manifest: result.manifest,
                });

                if (result.isNew) {
                  Alert.alert(
                    "更新完成",
                    "新版本已下载完成，需要重启应用才能生效。是否立即重启？",
                    [
                      { text: "稍后重启", style: "cancel" },
                      {
                        text: "立即重启",
                        onPress: () => Updates.reloadAsync(),
                      },
                    ]
                  );
                } else {
                  Alert.alert("提示", "已是最新版本");
                }
              } catch (error) {
                let errorMessage = "下载更新时出错";
                if (error instanceof Error) {
                  errorMessage += `: ${error.message}`;
                  if (error.message.includes("network")) {
                    errorMessage += "\n请检查网络连接";
                  }
                }
                Alert.alert("更新失败", errorMessage);
              }
            },
          },
        ],
        { cancelable: false }
      );
    } catch (error) {
      console.error('完整的更新检查错误:', error);
      
      // 捕获签名验证错误的原始数据
      if (error.message.includes('Code signature validation failed')) {
        console.log('尝试获取签名验证详情:');
        try {
          const update = await Updates.checkForUpdateAsync();
          console.log('更新清单原始数据:', update.manifest);
        } catch (innerError) {
          console.error('获取更新清单失败:', innerError);
        }
      }

      let errorMessage = "更新检查失败";
      if (error instanceof Error) {
        // 处理签名验证错误
        if (error.message.includes('Code signature validation failed')) {
          errorMessage = `签名验证失败: ${error.message.split(':')[1]?.trim() || '未知错误'}`;
          
          // 添加调试建议
          errorMessage += '\n\n可能原因:';
          errorMessage += '\n1. 服务器签名格式不正确';
          errorMessage += '\n2. 客户端/服务器密钥不匹配';
          errorMessage += '\n3. 网络传输问题';
        } 
        // 其他错误处理保持不变
        else if (error.message.includes("network")) {
          errorMessage = "网络连接失败，请检查网络设置";
        } else if (error.message.includes("certificate")) {
          errorMessage = "安全连接失败，请检查系统时间";
        } else {
          errorMessage = `错误: ${error.message}`;
        }
      }

      Alert.alert("更新检查失败", errorMessage, [
        { text: "确定" },
        {
          text: "查看日志",
          onPress: () => console.log('完整错误日志:', error),
        },
      ]);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <Text>{Constants.expoConfig.name}</Text>
      <Image source={require('./assets/favicon.png')} />
      <Button title="Check for updates" onPress={checkForUpdates} />
      <Text>{message}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});