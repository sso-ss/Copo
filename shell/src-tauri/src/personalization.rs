use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BuddySize { Small, #[default] Medium, Large }

impl BuddySize {
    pub fn dimensions(self) -> (f64, f64) {
        let scale = match self { Self::Small => 0.75, Self::Medium => 1.0, Self::Large => 1.35 };
        (160.0 * scale, 194.0 * scale)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Appearance { #[default] System, Light, Dark }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BuddyCharacter { #[default] Cat, Puff }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences { pub buddy_size: BuddySize, pub appearance: Appearance, pub buddy_character: BuddyCharacter }

#[derive(Default)]
pub struct PreferencesState(Mutex<Preferences>);

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    copo_data_dir(app).map(|dir| dir.join("personalization.json"))
}

pub fn load(app: &AppHandle) {
    let value: Preferences = path(app).and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    *app.state::<PreferencesState>().0.lock().unwrap() = value;
    apply_theme(app, value.appearance);
}

fn apply_theme(app: &AppHandle, appearance: Appearance) {
    app.set_theme(match appearance { Appearance::System => None, Appearance::Light => Some(tauri::Theme::Light), Appearance::Dark => Some(tauri::Theme::Dark) });
}

#[tauri::command]
pub fn companion_preferences(app: AppHandle) -> Preferences {
    *app.state::<PreferencesState>().0.lock().unwrap()
}

#[tauri::command]
pub fn set_companion_preferences(app: AppHandle, buddy_size: Option<BuddySize>, appearance: Option<Appearance>, buddy_character: Option<BuddyCharacter>) -> Result<Preferences, String> {
    let state = app.state::<PreferencesState>();
    let mut saved = state.0.lock().unwrap();
    let next = Preferences { buddy_size: buddy_size.unwrap_or(saved.buddy_size), appearance: appearance.unwrap_or(saved.appearance), buddy_character: buddy_character.unwrap_or(saved.buddy_character) };
    let path = path(&app).ok_or("Preferences unavailable")?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|_| "Could not save preferences")?; }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec(&next).map_err(|_| "Could not save preferences")?)
        .and_then(|_| std::fs::rename(&temporary, &path)).map_err(|_| "Could not save preferences")?;
    *saved = next;
    drop(saved);
    companion::resize_pet(&app, next.buddy_size);
    apply_theme(&app, next.appearance);
    let _ = app.emit("companion:preferences", next);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sizes_preserve_proportions_and_preferences_validate() {
        for size in [BuddySize::Small, BuddySize::Medium, BuddySize::Large] {
            let (width, height) = size.dimensions();
            assert!((width / height - 160.0 / 194.0).abs() < 0.00001);
        }
        let value = Preferences { buddy_size: BuddySize::Large, appearance: Appearance::Dark, buddy_character: BuddyCharacter::Puff };
        assert_eq!(serde_json::from_str::<Preferences>(&serde_json::to_string(&value).unwrap()).unwrap(), value);
        assert_eq!(serde_json::from_str::<Preferences>("{}").unwrap(), Preferences::default());
        assert!(serde_json::from_str::<Preferences>(r#"{"buddySize":"huge"}"#).is_err());
        let legacy: Preferences = serde_json::from_str(r#"{"buddySize":"large","appearance":"dark"}"#).unwrap();
        assert_eq!(legacy.buddy_character, BuddyCharacter::Cat);
        assert_eq!(legacy.buddy_size, BuddySize::Large);
        assert!(serde_json::from_str::<Preferences>(r#"{"buddyCharacter":"unknown"}"#).is_err());
    }
}
