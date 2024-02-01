window.addEventListener("message", (e) => {
  e.data.action === "returnCloudAddress" && (window.cloudAddress = e.data.cloudAddress);
});
window.parent?.postMessage({ action: "getCloudAddress" });
function s(e) {
  let o = !1;
  return e.onShown.addListener((t) => {
    o || (o = !0, t.setCloudAddress(window.cloudAddress));
  }), null;
}
chrome.devtools.panels.create("Hero Script", "/img/logo.svg", "/extension/hero-script.html", s);
chrome.devtools.panels.create("Resources", "/img/resource.svg", "/extension/resources.html", s);
chrome.devtools.panels.create("State Generator", "/img/element.svg", "/extension/state-generator.html", s);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGV2dG9vbHMubWpzIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9jaHJvbWUtZXh0ZW5zaW9uL3NyYy9kZXZ0b29scy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLy8gPHJlZmVyZW5jZSB0eXBlcz1cImNocm9tZVwiLz5cblxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBldmVudCA9PiB7XG4gIGlmIChldmVudC5kYXRhLmFjdGlvbiA9PT0gJ3JldHVybkNsb3VkQWRkcmVzcycpIHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgd2luZG93LmNsb3VkQWRkcmVzcyA9IGV2ZW50LmRhdGEuY2xvdWRBZGRyZXNzO1xuICB9XG59KTtcblxud2luZG93LnBhcmVudD8ucG9zdE1lc3NhZ2UoeyBhY3Rpb246ICdnZXRDbG91ZEFkZHJlc3MnIH0pO1xuXG5mdW5jdGlvbiBvblBhbmVsKGV4dGVuc2lvblBhbmVsKSB7XG4gIGxldCBydW5PbmNlID0gZmFsc2U7XG4gIGV4dGVuc2lvblBhbmVsLm9uU2hvd24uYWRkTGlzdGVuZXIocGFuZWxXaW5kb3cgPT4ge1xuICAgIGlmIChydW5PbmNlKSByZXR1cm47XG4gICAgcnVuT25jZSA9IHRydWU7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIHBhbmVsV2luZG93LnNldENsb3VkQWRkcmVzcyh3aW5kb3cuY2xvdWRBZGRyZXNzKTtcbiAgfSk7XG4gIHJldHVybiBudWxsO1xufVxuXG5jaHJvbWUuZGV2dG9vbHMucGFuZWxzLmNyZWF0ZSgnSGVybyBTY3JpcHQnLCAnL2ltZy9sb2dvLnN2ZycsICcvZXh0ZW5zaW9uL2hlcm8tc2NyaXB0Lmh0bWwnLCBvblBhbmVsKTtcbmNocm9tZS5kZXZ0b29scy5wYW5lbHMuY3JlYXRlKCdSZXNvdXJjZXMnLCAnL2ltZy9yZXNvdXJjZS5zdmcnLCAnL2V4dGVuc2lvbi9yZXNvdXJjZXMuaHRtbCcsIG9uUGFuZWwpO1xuY2hyb21lLmRldnRvb2xzLnBhbmVscy5jcmVhdGUoJ1N0YXRlIEdlbmVyYXRvcicsICcvaW1nL2VsZW1lbnQuc3ZnJywgJy9leHRlbnNpb24vc3RhdGUtZ2VuZXJhdG9yLmh0bWwnLCBvblBhbmVsKTtcbiJdLCJuYW1lcyI6WyJldmVudCIsIm9uUGFuZWwiLCJleHRlbnNpb25QYW5lbCIsInJ1bk9uY2UiLCJwYW5lbFdpbmRvdyJdLCJtYXBwaW5ncyI6IkFBRUEsT0FBTyxpQkFBaUIsV0FBVyxDQUFTQSxNQUFBO0FBQ3RDLEVBQUFBLEVBQU0sS0FBSyxXQUFXLHlCQUVqQixPQUFBLGVBQWVBLEVBQU0sS0FBSztBQUVyQyxDQUFDO0FBRUQsT0FBTyxRQUFRLFlBQVksRUFBRSxRQUFRLGtCQUFtQixDQUFBO0FBRXhELFNBQVNDLEVBQVFDLEdBQWdCO0FBQy9CLE1BQUlDLElBQVU7QUFDQyxTQUFBRCxFQUFBLFFBQVEsWUFBWSxDQUFlRSxNQUFBO0FBQzVDLElBQUFELE1BQ01BLElBQUEsSUFFRUMsRUFBQSxnQkFBZ0IsT0FBTyxZQUFZO0FBQUEsRUFBQSxDQUNoRCxHQUNNO0FBQ1Q7QUFFQSxPQUFPLFNBQVMsT0FBTyxPQUFPLGVBQWUsaUJBQWlCLCtCQUErQkgsQ0FBTztBQUNwRyxPQUFPLFNBQVMsT0FBTyxPQUFPLGFBQWEscUJBQXFCLDZCQUE2QkEsQ0FBTztBQUNwRyxPQUFPLFNBQVMsT0FBTyxPQUFPLG1CQUFtQixvQkFBb0IsbUNBQW1DQSxDQUFPOyJ9
