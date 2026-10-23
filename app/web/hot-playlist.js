// 热门歌单 - 独立页面
var hotSrc = "kw";

window.switchHotSrc = function(src) {
  hotSrc = src;
  // 更新按钮样式
  var btns = document.querySelectorAll("#tab-hot-playlist button");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute("onclick") && btns[i].getAttribute("onclick").indexOf(src) >= 0) {
      btns[i].style.background = "var(--blue)";
      btns[i].style.color = "white";
    } else {
      btns[i].style.background = "var(--bg3)";
      btns[i].style.color = "var(--text)";
    }
  }
  loadHotPlaylistList();
};

window.loadHotPlaylistList = function() {
  var content = document.getElementById("hotPlaylistList");
  if (!content) return;
  content.innerHTML = "加载中...";
  
  fetch("/api/music/songList/list?source=" + hotSrc + "&page=1", {
    headers: {
      "x-user-name": typeof currentUser !== "undefined" ? currentUser : "",
      "x-frontend-auth": typeof authPassword !== "undefined" ? authPassword : ""
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var list = data.list || [];
    if (list.length === 0) {
      content.innerHTML = "暂无歌单";
      return;
    }
    
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var pl = list[i];
      var safeId = (pl.id || "").replace(/"/g, "&quot;");
      var safeName = (pl.name || "").replace(/"/g, "&quot;");
      html += '<div onclick="openHotDetail(\'' + safeId + '\',\'' + safeName + '\')" style="padding:12px; margin:8px 0; background:var(--bg2); border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:12px;">'
        + '<div style="width:48px; height:48px; border-radius:6px; background:linear-gradient(135deg,#722ed1,#1890ff); display:flex; align-items:center; justify-content:center; color:white; font-size:20px; flex-shrink:0;">🎵</div>'
        + '<div style="flex:1; min-width:0;">'
        + '<div style="color:var(--text); font-size:14px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (pl.name || "") + '</div>'
        + '<div style="color:var(--text2); font-size:12px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (pl.desc || "") + '</div>'
        + '</div>'
        + '</div>';
    }
    content.innerHTML = html;
  })
  .catch(function(e) {
    content.innerHTML = "加载失败: " + e.message;
  });
};

window.openHotDetail = function(id, name) {
  var content = document.getElementById("hotPlaylistList");
  if (!content) return;
  content.innerHTML = "加载歌单详情...";
  
  fetch("/api/music/songList/detail?source=" + hotSrc + "&id=" + encodeURIComponent(id), {
    headers: {
      "x-user-name": typeof currentUser !== "undefined" ? currentUser : "",
      "x-frontend-auth": typeof authPassword !== "undefined" ? authPassword : ""
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var songs = data.list || [];
    var html = '<div style="margin-bottom:12px; display:flex; gap:8px; align-items:center;">'
      + '<button onclick="loadHotPlaylistList()" style="padding:5px 12px; background:var(--bg3); color:var(--text); border:none; border-radius:6px; cursor:pointer; font-size:12px;">← 返回</button>'
      + '<span style="color:var(--text); font-size:14px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + name + '</span>'
      + '</div>';
    
    if (songs.length === 0) {
      html += '<div style="text-align:center; color:var(--text2); padding:20px;">暂无歌曲</div>';
    } else {
      for (var i = 0; i < songs.length; i++) {
        var song = songs[i];
        html += '<div style="padding:10px; margin:6px 0; background:var(--bg2); border-radius:6px; display:flex; align-items:center; gap:10px;">'
          + '<span style="color:var(--text2); font-size:12px; width:20px; flex-shrink:0;">' + (i+1) + '</span>'
          + '<div style="flex:1; min-width:0;">'
          + '<div style="color:var(--text); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (song.name || "") + '</div>'
          + '<div style="color:var(--text2); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (song.singer || "") + '</div>'
          + '</div>'
          + '</div>';
      }
    }
    content.innerHTML = html;
  })
  .catch(function(e) {
    content.innerHTML = "加载失败: " + e.message;
  });
};

// 页面加载后自动加载一次
setTimeout(loadHotPlaylistList, 500);
