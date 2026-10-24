#pragma once

#include <node_api.h>

#include <stdexcept>
#include <string>

inline void NapiCheck(napi_status status, const char* what) {
  if (status != napi_ok) throw std::runtime_error(what);
}

inline napi_value JsInt(napi_env env, int value) {
  napi_value out;
  NapiCheck(napi_create_int32(env, value, &out), "napi_create_int32");
  return out;
}

inline napi_value JsU64(napi_env env, uint64_t value) {
  napi_value out;
  NapiCheck(napi_create_double(env, static_cast<double>(value), &out), "napi_create_double");
  return out;
}

inline napi_value JsBool(napi_env env, bool value) {
  napi_value out;
  NapiCheck(napi_get_boolean(env, value, &out), "napi_get_boolean");
  return out;
}

inline napi_value JsString(napi_env env, const std::string& value) {
  napi_value out;
  NapiCheck(napi_create_string_utf8(env, value.c_str(), value.size(), &out), "napi_create_string_utf8");
  return out;
}

inline napi_value JsNull(napi_env env) {
  napi_value out;
  NapiCheck(napi_get_null(env, &out), "napi_get_null");
  return out;
}

class JsObject {
 public:
  explicit JsObject(napi_env env) : env_(env) {
    NapiCheck(napi_create_object(env, &value_), "napi_create_object");
  }

  napi_value get() const { return value_; }

  void set(const char* name, napi_value child) {
    NapiCheck(napi_set_named_property(env_, value_, name, child), name);
  }

  void setInt(const char* name, int value) { set(name, JsInt(env_, value)); }
  void setBool(const char* name, bool value) { set(name, JsBool(env_, value)); }
  void setString(const char* name, const std::string& value) { set(name, JsString(env_, value)); }

 private:
  napi_env env_;
  napi_value value_{};
};

inline int32_t GetInt(napi_env env, napi_value object, const char* name) {
  napi_value value;
  NapiCheck(napi_get_named_property(env, object, name, &value), name);
  int32_t out = 0;
  NapiCheck(napi_get_value_int32(env, value, &out), name);
  return out;
}

inline std::string GetString(napi_env env, napi_value object, const char* name) {
  napi_value value;
  NapiCheck(napi_get_named_property(env, object, name, &value), name);
  size_t length = 0;
  NapiCheck(napi_get_value_string_utf8(env, value, nullptr, 0, &length), name);
  std::string out(length, '\0');
  if (length == 0) return out;
  NapiCheck(napi_get_value_string_utf8(env, value, out.data(), length + 1, &length), name);
  return out;
}

inline napi_value Argv(napi_env env, napi_callback_info info, size_t index, size_t expected) {
  constexpr size_t kMax = 4;
  if (expected > kMax) throw std::runtime_error("too many arguments");
  size_t argc = expected;
  napi_value argv[kMax] = {};
  NapiCheck(napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "napi_get_cb_info");
  if (argc <= index) throw std::runtime_error("missing argument");
  return argv[index];
}

#define NAPI_METHOD(name, impl)                                                              \
  napi_value name(napi_env env, napi_callback_info info) {                                   \
    try {                                                                                    \
      return impl(env, info);                                                                \
    } catch (const std::exception& ex) {                                                     \
      napi_throw_error(env, nullptr, ex.what());                                             \
      return nullptr;                                                                        \
    }                                                                                        \
  }
