import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View, Image, Button } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export default function App() {
  const [message, setMessage] = useState('');
  const [assets, setAssets] = useState([]);
  async function onFetchUpdateAsync() {
    try {
      setMessage("开始更新...")
      /**
       * 检查服务器以查看项目的新部署更新是否可用
       * - isAvailable： 更新是否可用
       * - isRollBackToEmbedded： 回滚到嵌入式更新是否可用
       * - manifest: 可用的更新的清单。
       *   - assets： ManifestAsset[]
       *   - createdAt： string
       *   - extra： ManifestExtra
       *     - eas: EASConfig
       *     - expoClient: ExpoClientConfig
       *     - expoGo: ExpoGoConfig
       *   - id： string
       *   - launchAsset: ManifestAsset
       *   - metadata: object
       *   - runtimeVersion: string
       * - reason: 如果没有发现更新，它将包含原因（枚举值）
       */
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setMessage("发现可用更新,更新资源为：" + update.manifest.assets[0].url + "\n开始下载更新...");
        // 下载服务器上的更新到本地存储
        await Updates.fetchUpdateAsync();
        setMessage(message + "下载更新完成，开始重新加载应用");
        // 使用最近下载的版本重新加载本应用
        // 添加延迟确保资源加载完成
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        await Updates.reloadAsync();
        // await Updates.reloadAsync();
        setMessage(message + "\n" + "重新加载应用成功");
      } else {
        setMessage("没有可用更新");
      }
    } catch (error) {
      // You can also add an alert() to see the error message in case of an error when fetching updates.
      alert(`Error fetching latest Expo update: ${error}`);
    }
  }

  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app! Updated!</Text>
      <Text>{Constants.expoConfig.name}</Text>
      <Image source={require('./assets/favicon.png')} />
      <StatusBar style="auto" />
      <Button title="Fetch update" onPress={onFetchUpdateAsync} />
      <Text>{message}</Text>
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