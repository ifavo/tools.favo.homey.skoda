# Debugging Homey App Crashes

## Accessing Logs

### 1. Homey App (Mobile/Tablet)
- Open Homey app
- Go to **Settings** → **Apps** → **Skoda** → **Logs**
- Or **Settings** → **Developer** → **Logs** (if developer mode enabled)

### 2. Homey Web Interface
- Open `http://homey.local` (or your Homey's IP address)
- Go to **Settings** → **Apps** → **Skoda** → **Logs**
- Or **Settings** → **Developer** → **Logs**

### 3. SSH Access (if enabled)
```bash
# SSH into your Homey
ssh root@homey.local

# View app logs
homey app log --app tools.favo.homey.skoda

# View all Homey logs
homey log

# View system logs for the app
journalctl -u homey-app-tools.favo.homey.skoda

# Follow logs in real-time
homey app log --app tools.favo.homey.skoda --follow
```

### 4. SSH Access (from development machine)
**Note**: The `homey app log` command is not available in Homey CLI. Use SSH instead:

```bash
# SSH into your Homey (if SSH is enabled)
ssh root@homey.local

# Once connected, view app logs
homey app log --app tools.favo.homey.skoda

# Follow logs in real-time
homey app log --app tools.favo.homey.skoda --follow

# View all Homey logs
homey log

# View system logs for the app
journalctl -u homey-app-tools.favo.homey.skoda -f
```

**Alternative**: If SSH is not enabled, use the Homey web interface or mobile app (methods 1 & 2 above).

## Common Crash Causes

### 1. Unhandled Promise Rejections
Look for errors like:
- `UnhandledPromiseRejectionWarning`
- `Error: ...`
- Stack traces pointing to specific files

**Solution**: Ensure all async functions have `.catch()` handlers

### 2. Missing Error Handling
Check for:
- API calls without try/catch
- Missing null/undefined checks
- Type errors

**Solution**: Add comprehensive error handling

### 3. Memory Issues
Look for:
- `Out of memory`
- `Maximum call stack size exceeded`
- Increasing memory usage over time

**Solution**: Check for memory leaks in intervals/listeners

### 4. Network/API Errors
Look for:
- `ECONNREFUSED`
- `ETIMEDOUT`
- `401 Unauthorized`
- `500 Internal Server Error`

**Solution**: Add retry logic and better error messages

## Debugging Tips

### Enable More Verbose Logging
Add more `this.log()` and `this.error()` statements in critical sections:
- API calls
- Error handlers
- Interval callbacks
- Capability listeners

### Check Device State
```bash
# SSH into Homey and check device state
homey app run --app tools.favo.homey.skoda
```

### Check App Settings
- Verify refresh token is set correctly
- Check device settings for invalid values
- Look for missing required settings

### Common Log Patterns to Look For

1. **Token Errors**:
   ```
   [TOKEN] Error refreshing access token
   Authentication failed
   ```

2. **API Errors**:
   ```
   [INFO] Failed to refresh vehicle info
   [VEHICLES] List vehicles failed
   ```

3. **Device Errors**:
   ```
   Error updating capabilities
   Failed to set device image
   ```

4. **Interval Errors**:
   ```
   Error in polling interval
   Price update failed
   ```

## Quick Debug Checklist

- [ ] Check Homey app logs for error messages (via mobile app or web interface)
- [ ] Look for stack traces pointing to specific code
- [ ] Check if error occurs at specific times (e.g., during polling)
- [ ] Verify all API endpoints are accessible
- [ ] Check if refresh token is valid
- [ ] Look for memory leaks (intervals not cleared)
- [ ] Check for unhandled promise rejections
- [ ] Verify device settings are valid

## Accessing Logs - Quick Reference

**Easiest Method**: Use the Homey mobile app or web interface
- Mobile: Settings → Apps → Skoda → Logs
- Web: `http://homey.local` → Settings → Apps → Skoda → Logs

**SSH Method** (if enabled):
```bash
ssh root@homey.local
homey app log --app tools.favo.homey.skoda --follow
```

**Note**: The `homey app log` command only works when SSH'd into the Homey device itself, not from your development machine.

## Getting Help

When reporting crashes, include:
1. Full error message from logs
2. Stack trace (if available)
3. When the crash occurs (on init, during polling, etc.)
4. Device settings (without sensitive data)
5. Homey version
6. App version

