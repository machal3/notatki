```cpp
dp[i][j]// - koszt połączenia i wagonów od miejsca j do miejsca j + i
```

```cpp
dp[i][j] = min(dp[k][j]+dp[i-k][j+k]) // + suma(l = j do i+j)al 
```

